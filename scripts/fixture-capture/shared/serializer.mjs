/**
 * Fiber tree serializer — captures live Fiber tree structure from a real React
 * runtime, strips circular references, and produces a JSON-safe snapshot.
 *
 * PRINCIPLE: This code is NOT for production use. It exists only to generate
 * ground-truth fixture data for React Insight's test suite.
 */

/**
 * Walk a committed Fiber tree and return a JSON-serializable object tree.
 * Back-references (return, sibling) are replaced with numeric __fiberId refs.
 * Hook linked lists are flattened into arrays.
 */
export function serializeFiberTree(rootFiber) {
  let nextFiberId = 1;
  const fiberToId = new WeakMap();

  function fid(fiber) {
    if (!fiber) return null;
    if (!fiberToId.has(fiber)) {
      fiberToId.set(fiber, nextFiberId++);
    }
    return fiberToId.get(fiber);
  }

  function walk(fiber, depth = 0) {
    if (!fiber || depth > 100) return null;

    const node = {
      __fiberId: fid(fiber),
      tag: fiber.tag,
      type: serializeType(fiber.type),
      key: fiber.key,
      pendingProps: truncate(fiber.pendingProps),
      memoizedProps: truncate(fiber.memoizedProps),
      memoizedState: serializeMemoizedState(fiber),
      updateQueue: serializeUpdateQueue(fiber),
    };

    // Debug source
    if (fiber._debugSource) {
      node._debugSource = {
        fileName: fiber._debugSource.fileName,
        lineNumber: fiber._debugSource.lineNumber,
        columnNumber: fiber._debugSource.columnNumber,
      };
    }

    // Debug owner
    if (fiber._debugOwner) {
      node._debugOwner = {
        __fiberId: fid(fiber._debugOwner),
        type: serializeType(fiber._debugOwner.type),
      };
    }

    // Lane info
    if (fiber.lanes !== undefined && fiber.lanes !== 0) {
      node.lanes = fiber.lanes;
    }

    // Structure
    if (fiber.child) {
      node.child = walk(fiber.child, depth + 1);
    }
    if (fiber.sibling) {
      node.sibling = walk(fiber.sibling, depth);
    }

    return node;
  }

  return walk(rootFiber);
}

/* ─── helpers ─── */

function serializeType(t) {
  if (t === null || t === undefined) return t;
  if (typeof t === 'string') return t;
  if (typeof t === 'function') return t.displayName || t.name || '(anonymous)';
  if (typeof t === 'object') {
    if (t.$$typeof) {
      const sym = String(t.$$typeof);
      if (sym.includes('react.provider')) return '(Context.Provider)';
      if (sym.includes('react.context')) return '(Context)';
      if (sym.includes('react.forward_ref')) return '(ForwardRef)';
      if (sym.includes('react.memo')) return '(Memo)';
      if (sym.includes('react.lazy')) return '(Lazy)';
      return sym;
    }
    return '(object)';
  }
  return String(t);
}

function serializeMemoizedState(fiber) {
  const tag = fiber.tag;
  // Function component & SimpleMemoComponent (0 or 15)
  if (tag === 0 || tag === 15) {
    return serializeHooks(fiber.memoizedState);
  }
  // IndeterminateComponent (2) — may become function
  if (tag === 2) {
    return serializeHooks(fiber.memoizedState);
  }
  // Class component (1)
  if (tag === 1) {
    return safeClone(fiber.memoizedState, 2);
  }
  // HostRoot (3)
  if (tag === 3) {
    return fiber.memoizedState ? { element: truncate(fiber.memoizedState.element) } : null;
  }
  // ContextConsumer (9), ContextProvider (10), ForwardRef (11), Memo (14),
  // Offscreen (22), Cache (24)
  if ([9, 10, 11, 14, 22, 24].includes(tag)) {
    return truncate(fiber.memoizedState);
  }
  // HostComponent (5), HostText (6), Fragment (7), Mode (8), etc — null or element
  return fiber.memoizedState !== undefined ? safeClone(fiber.memoizedState, 1) : undefined;
}

function serializeHooks(headHook) {
  if (!headHook) return null;
  const hooks = [];
  let current = headHook;
  let id = 0;
  while (current) {
    hooks.push({
      __hookId: id++,
      memoizedState: safeClone(current.memoizedState, 2),
      baseState: safeClone(current.baseState, 2),
      baseQueue: current.baseQueue ? '(has baseQueue)' : null,
      queue: serializeQueue(current.queue),
      next: current.next ? `__hookId:${id}` : null, // points to next hook
    });
    current = current.next;
  }
  return hooks;
}

function serializeQueue(queue) {
  if (!queue) return null;
  const obj = {};
  if (queue.lastRenderedState !== undefined) {
    obj.lastRenderedState = safeClone(queue.lastRenderedState, 1);
  }
  if (queue.lastRenderedReducer !== undefined) {
    obj.hasReducer = typeof queue.lastRenderedReducer === 'function';
  }
  obj.pending = queue.pending ? '(circular update chain)' : null;
  obj.dispatch = typeof queue.dispatch === 'function' ? '__dispatch__' : null;
  return obj;
}

function serializeUpdateQueue(uq) {
  if (!uq) return null;

  // Effects (function component effects stored in updateQueue.lastEffect)
  const lastEffect = uq.lastEffect;
  if (lastEffect) {
    return _serializeEffects(lastEffect);
  }

  // HostRoot or class update queue
  return {
    firstBaseUpdate: uq.firstBaseUpdate ? '(present)' : null,
    shared: uq.shared ? uq.shared.pending ? '(has pending)' : '(no pending)' : null,
  };
}

function _serializeEffects(lastEffect) {
  if (!lastEffect) return { effects: [] };
  const effects = [];
  let current = lastEffect;
  // Walk at most one full circuit to avoid infinite loop
  for (let i = 0; i < 200; i++) {
    effects.push({
      tag: current.tag,
      deps: current.deps,
      create: typeof current.create === 'function' ? '__effect__' : current.create,
      destroy: typeof current.destroy === 'function' ? '__effect__' : current.destroy,
      flags: current.flags,
    });
    current = current.next;
    if (!current || current === lastEffect) break;
  }
  return { effects };
}

/* ─── generic truncation / safe-clone ─── */

// Per-serialization set of visited objects to break cycles
const _visited = new WeakSet();

function safeClone(value, depth = 3) {
  if (depth <= 0 || value === null || value === undefined) return value;
  if (typeof value === 'string') return maybeTruncateString(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'function') return `__fn__${value.name || '(anonymous)'}`;
  if (typeof value === 'object') {
    // Detect and skip DOM elements — they carry React container backrefs
    if (value instanceof HTMLElement) return '(HTMLElement)';
    if (value instanceof Text) return '(TextNode)';
    // Cycle detection — if we've seen this object reference before, stop.
    if (_visited.has(value)) return '(cycle)';
    _visited.add(value);
    try {
      if (Array.isArray(value)) {
        if (value.length > 50) {
          const items = value.slice(0, 50).map(v => safeClone(v, depth - 1));
          items.push(`__truncated__(${value.length - 50} more)`);
          return items;
        }
        return value.map(v => safeClone(v, depth - 1));
      }
      const obj = {};
      const keys = Object.keys(value).slice(0, 50);
      for (const key of keys) {
        // Skip React internals that often carry circular backreferences
        if (key.startsWith('__') || key.startsWith('_react') || key.startsWith('__react')) continue;
        try {
          obj[key] = safeClone(value[key], depth - 1);
        } catch { obj[key] = '(error reading)'; }
      }
      return obj;
    } finally {
      _visited.delete(value);
    }
  }
  return String(value);
}

function resetVisited() {
  _visited.clear();
}

function truncate(value) {
  return safeClone(value, 2);
}

function maybeTruncateString(s) {
  if (typeof s === 'string' && s.length > 500) {
    return s.slice(0, 500) + `__truncated__(${s.length - 500} more chars)`;
  }
  return s;
}
