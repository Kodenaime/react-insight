/**
 * Diff Engine — deterministic test suite.
 *
 * Covers:
 *   1. Primitive equality (fast path)
 *   2. Shallow reference equality (same object)
 *   3. Deep value equality (different objects, same structure)
 *   4. Reference inequality (reference changed, values identical within limits)
 *   5. Structural difference (actual value changes)
 *   6. Circular reference handling (WeakSet cycle guard — no stack overflow)
 *   7. Truncation at depth > 4
 *   8. Truncation at 50+ keys per level
 *   9. Array comparisons
 *  10. Mixed-type comparisons
 */

import { describe, it, expect } from 'vitest';
import { compareValues, DEFAULT_MAX_DEPTH } from '../src/engine/diffEngine';

describe('diffEngine — compareValues', () => {
  // ── 1. Fast Path: primitives ───────────────────────────────

  describe('fast path — same reference', () => {
    it('returns IDENTICAL for same number', () => {
      const r = compareValues(42, 42);
      expect(r.status).toBe('IDENTICAL');
      expect(r.reason).toBeNull();
      expect(r.changedPaths).toHaveLength(0);
      expect(r.truncated).toBe(false);
    });

    it('returns IDENTICAL for same string', () => {
      const r = compareValues('hello', 'hello');
      expect(r.status).toBe('IDENTICAL');
    });

    it('returns IDENTICAL for same boolean', () => {
      const r = compareValues(true, true);
      expect(r.status).toBe('IDENTICAL');
    });

    it('returns IDENTICAL for null === null', () => {
      const r = compareValues(null, null);
      expect(r.status).toBe('IDENTICAL');
    });

    it('returns IDENTICAL for undefined === undefined', () => {
      const r = compareValues(undefined, undefined);
      expect(r.status).toBe('IDENTICAL');
    });

    it('returns IDENTICAL for same object reference', () => {
      const obj = { a: 1 };
      const r = compareValues(obj, obj);
      expect(r.status).toBe('IDENTICAL');
    });
  });

  // ── 2. Deep equality: VALUES_IDENTICAL ─────────────────────

  describe('deep path — values identical', () => {
    it('returns VALUES_IDENTICAL for structurally equal plain objects', () => {
      const prev = { a: 1, b: 'hello', c: true };
      const next = { a: 1, b: 'hello', c: true };
      const r = compareValues(prev, next);

      expect(r.status).toBe('VALUES_IDENTICAL');
      expect(r.reason).toContain('Values are identical within the first');
      expect(r.reason).toContain('Fix: move outside render loop or wrap in useMemo');
      expect(r.changedPaths).toHaveLength(0);
      expect(r.truncated).toBe(false);
    });

    it('returns VALUES_IDENTICAL for nested objects with same values', () => {
      const prev = { config: { theme: 'dark', fontSize: 14 } };
      const next = { config: { theme: 'dark', fontSize: 14 } };
      const r = compareValues(prev, next);

      expect(r.status).toBe('VALUES_IDENTICAL');
    });

    it('returns VALUES_IDENTICAL for arrays with same elements', () => {
      const prev = [1, 2, 3];
      const next = [1, 2, 3];
      const r = compareValues(prev, next);

      expect(r.status).toBe('VALUES_IDENTICAL');
    });

    it('returns VALUES_IDENTICAL for deeply nested matching structures', () => {
      const prev = { level1: { level2: { level3: { level4: { key: 'deep' } } } } };
      const next = { level1: { level2: { level3: { level4: { key: 'deep' } } } } };
      const r = compareValues(prev, next);

      expect(r.status).toBe('VALUES_IDENTICAL');
    });

    it('treats functions with the same name as identical', () => {
      function onClick() {}
      const prev = { handler: onClick };
      const next = { handler: onClick };
      const r = compareValues(prev, next);

      // Same function reference nested inside different wrapper objects
      // → values match within depth limits
      expect(r.status).toBe('VALUES_IDENTICAL');
    });
  });

  // ── 3. Structural differences: CHANGED ─────────────────────

  describe('deep path — values changed', () => {
    it('detects changed primitive value at root', () => {
      const r = compareValues({ a: 1 }, { a: 2 });
      expect(r.status).toBe('CHANGED');
      expect(r.changedPaths).toHaveLength(1);
      expect(r.changedPaths[0].path).toBe('a');
      expect(r.changedPaths[0].changeType).toBe('value');
    });

    it('detects changed nested value', () => {
      const prev = { config: { theme: 'light' } };
      const next = { config: { theme: 'dark' } };
      const r = compareValues(prev, next);

      expect(r.status).toBe('CHANGED');
      expect(r.changedPaths.some(c => c.path === 'config.theme')).toBe(true);
    });

    it('detects added key', () => {
      const r = compareValues({ a: 1 }, { a: 1, b: 2 });
      expect(r.status).toBe('CHANGED');
      expect(r.changedPaths.some(c => c.path === 'b')).toBe(true);
    });

    it('detects removed key', () => {
      const r = compareValues({ a: 1, b: 2 }, { a: 1 });
      expect(r.status).toBe('CHANGED');
      expect(r.changedPaths.some(c => c.path === 'b')).toBe(true);
    });

    it('detects type mismatch (number vs string)', () => {
      const r = compareValues({ a: 1 }, { a: '1' });
      expect(r.status).toBe('CHANGED');
    });

    it('detects array length difference', () => {
      const r = compareValues([1, 2], [1, 2, 3]);
      expect(r.status).toBe('CHANGED');
    });

    it('reports reference change for object values', () => {
      const prev = { data: { nested: true } };
      const next = { data: { nested: true } };
      const r = compareValues(prev, next);

      // Both `data` values are objects with same internal values,
      // but different references
      expect(r.status).toBe('VALUES_IDENTICAL');
      expect(r.changedPaths).toHaveLength(0);
    });

    it('reports changed array elements', () => {
      const prev = { items: [1, 2, 3] };
      const next = { items: [1, 99, 3] };
      const r = compareValues(prev, next);

      expect(r.status).toBe('CHANGED');
      expect(r.changedPaths.some(c => c.path.includes('[1]'))).toBe(true);
    });
  });

  // ── 4. Reference inequality (key DX pattern) ──────────────

  describe('reference inequality', () => {
    it('flags inline object creation as reference change', () => {
      const prev = { filterConfig: { active: true } };
      const next = { filterConfig: { active: true } };

      const r = compareValues(prev, next);

      // Values are identical within limits, but references changed
      expect(r.status).toBe('VALUES_IDENTICAL');
      expect(r.reason).toContain('Values are identical within the first');
    });
  });

  // ── 5. Circular references ─────────────────────────────────

  describe('circular reference handling', () => {
    it('handles self-referencing object without stack overflow', () => {
      const obj: Record<string, unknown> = { name: 'self' };
      obj.self = obj;

      // Should not throw — WeakSet cycle guard short-circuits
      expect(() => compareValues(obj, obj)).not.toThrow();
      const r = compareValues(obj, obj);
      expect(r.status).toBe('IDENTICAL');
    });

    it('handles circular objects that are structurally equal', () => {
      const a: Record<string, unknown> = { name: 'a' };
      a.self = a;
      const b: Record<string, unknown> = { name: 'a' };
      b.self = b;

      // Both have the same cycle structure — the engine should handle
      // this without errors
      expect(() => compareValues(a, b)).not.toThrow();
      const r = compareValues(a, b);
      // They're structurally equivalent within the cycle handler
      expect(r.status).toBe('VALUES_IDENTICAL');
    });

    it('handles circular objects with structural differences', () => {
      const a: Record<string, unknown> = { name: 'a' };
      a.self = a;
      const b: Record<string, unknown> = { name: 'b' };
      b.self = b;

      expect(() => compareValues(a, b)).not.toThrow();
      const r = compareValues(a, b);

      // The `name` field differs
      expect(r.status).toBe('CHANGED');
      expect(r.changedPaths.some(c => c.path === 'name')).toBe(true);
    });

    it('handles sibling cycles (a → b → a)', () => {
      const a: Record<string, unknown> = {};
      const b: Record<string, unknown> = { sibling: a };
      a.sibling = b;

      const a2: Record<string, unknown> = {};
      const b2: Record<string, unknown> = { sibling: a2 };
      a2.sibling = b2;

      expect(() => compareValues(a, a2)).not.toThrow();
    });

    it('handles deeply nested cycles without hanging', () => {
      const buildDeepCycle = (depth: number) => {
        const root: Record<string, unknown> = { value: depth };
        let current = root;
        for (let i = 0; i < depth; i++) {
          current.child = { value: depth - i - 1 };
          current = current.child as Record<string, unknown>;
        }
        // Close the cycle
        current.child = root;
        return root;
      };

      const obj = buildDeepCycle(10);
      expect(() => compareValues(obj, obj)).not.toThrow();
    });
  });

  // ── 6. Truncation ─────────────────────────────────────────

  describe('truncation at limits', () => {
    it('sets truncated=true when depth exceeds 4', () => {
      // Build objects 6 levels deep where all accessible values are identical,
      // and the ONLY difference is beyond depth 4.
      const buildDeep = (leafValue: number) => {
        let obj: Record<string, unknown> = { a: 'same' };
        let cursor: Record<string, unknown> = obj;
        for (let i = 0; i < 5; i++) {
          cursor.next = { a: 'same' };
          cursor = cursor.next as Record<string, unknown>;
        }
        // Set the leaf that would be at depth 6
        cursor.leaf = leafValue;
        return obj;
      };

      const prev = buildDeep(10);
      const next = buildDeep(20); // different at depth > 4

      const r = compareValues(prev, next);

      // The difference is beyond depth 4 — engine stops there and reports
      // VALUES_IDENTICAL with truncated=true
      expect(r.truncated).toBe(true);
      expect(r.status).toBe('VALUES_IDENTICAL');
      expect(r.reason).toContain('comparison truncated at configured limits');
    });

    it('sets truncated=true when object has more than 50 keys', () => {
      const bigObj1: Record<string, number> = {};
      const bigObj2: Record<string, number> = {};
      for (let i = 0; i < 60; i++) {
        bigObj1[`key${i}`] = i;
        bigObj2[`key${i}`] = i;
      }

      const r = compareValues(bigObj1, bigObj2);

      expect(r.truncated).toBe(true);
      expect(r.status).toBe('VALUES_IDENTICAL');
      expect(r.reason).toContain('comparison truncated at configured limits');
    });

    it('truncated=false when object has exactly 50 keys', () => {
      const obj1: Record<string, number> = {};
      const obj2: Record<string, number> = {};
      for (let i = 0; i < 50; i++) {
        obj1[`key${i}`] = i;
        obj2[`key${i}`] = i;
      }

      const r = compareValues(obj1, obj2);
      expect(r.truncated).toBe(false);
      expect(r.status).toBe('VALUES_IDENTICAL');
    });

    it('truncated flag is not set for depth=3 (within limit)', () => {
      // 3 levels deep: root → a → b → c (depth=3, maxDepth=4 → within limit)
      const prev = { a: { b: { c: 'same' } } };
      const next = { a: { b: { c: 'same' } } };

      const r = compareValues(prev, next);
      expect(r.truncated).toBe(false);
      expect(r.status).toBe('VALUES_IDENTICAL');
    });

    it('truncated=true and status=VALUES_IDENTICAL when the change is beyond the truncated key range', () => {
      // 60 keys, key55 differs — but key55 is beyond the first 50 keys scanned
      const obj1: Record<string, number> = {};
      const obj2: Record<string, number> = {};
      for (let i = 0; i < 60; i++) {
        obj1[`key${i}`] = i;
        obj2[`key${i}`] = i;
      }
      obj2.key55 = 999; // change beyond the first 50 keys

      const r = compareValues(obj1, obj2);
      // key55 is beyond the first 50 keys, so the diff doesn't see it
      expect(r.status).toBe('VALUES_IDENTICAL');
      expect(r.truncated).toBe(true);
      expect(r.reason).toContain('comparison truncated at configured limits');
    });
  });

  // ── 7. Edge cases ─────────────────────────────────────────

  describe('edge cases', () => {
    it('handles Date objects', () => {
      const prev = { date: new Date('2024-01-01') };
      const next = { date: new Date('2024-01-01') };
      const r = compareValues(prev, next);

      // Date objects are not deeply compared — they're treated as objects
      // with no enumerable keys, so they compare as VALUES_IDENTICAL
      expect(r.status).toBe('VALUES_IDENTICAL');
    });

    it('handles empty objects', () => {
      const r = compareValues({}, {});
      expect(r.status).toBe('VALUES_IDENTICAL');
    });

    it('handles empty arrays', () => {
      const r = compareValues([], []);
      expect(r.status).toBe('VALUES_IDENTICAL');
    });

    it('reports the depth reached', () => {
      const r = compareValues({ a: 1 }, { a: 1 });
      // depth 0 at root, 1+ for nesting — engine records the actual depth
      expect(r.depthReached).toBeGreaterThanOrEqual(1);
    });

    it('tracks maximum depth reached', () => {
      const prev = { a: { b: { c: { d: { e: 'deep' } } } } };
      const next = { a: { b: { c: { d: { e: 'deep' } } } } };
      const r = compareValues(prev, next);

      // 5 levels of objects: root → a → b → c → d → e (5 depth)
      // maxDepth=4 means we stop at `d`, so depthReached should be 4
      expect(r.depthReached).toBeGreaterThanOrEqual(4);
    });

    it('produces a human-readable reason string for changes', () => {
      const r = compareValues({ name: 'Alice' }, { name: 'Bob' });

      expect(r.status).toBe('CHANGED');
      expect(typeof r.reason).toBe('string');
      expect(r.reason!.length).toBeGreaterThan(10);
    });

    it('compares mixed arrays and objects without throwing', () => {
      const prev = { items: [1, { x: 2 }, [3, 4]] };
      const next = { items: [1, { x: 2 }, [3, 4]] };

      expect(() => compareValues(prev, next)).not.toThrow();
      const r = compareValues(prev, next);
      expect(r.status).toBe('VALUES_IDENTICAL');
    });

    it('reports changes in nested arrays', () => {
      const prev = { matrix: [[1, 2], [3, 4]] };
      const next = { matrix: [[1, 2], [3, 99]] };

      const r = compareValues(prev, next);
      expect(r.status).toBe('CHANGED');
      expect(r.changedPaths.some(c => c.path.includes('[1][1]'))).toBe(true);
    });
  });
});
