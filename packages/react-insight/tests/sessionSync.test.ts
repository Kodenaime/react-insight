import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { enableFileSync } from '../src/export/sessionSync';
import type { ComponentHistory } from '../src/engine/instanceTracker';
import type { HealthScore } from '../src/engine/healthEngine';

function makeSnapshot(): { histories: ComponentHistory[]; healthScore: HealthScore } {
  const histories: ComponentHistory[] = [
    {
      instanceId: 'App||0.0',
      componentName: 'App',
      renderCount: 2,
      wastedRenderCount: 1,
      lastRenderReason: 'PROP_REFERENCE_CHANGE',
      lastRenderWasted: true,
    },
  ];
  const healthScore: HealthScore = {
    score: 80,
    metrics: [],
    recommendations: [],
    weightsUsed: {
      wastedRenderWeight: 30,
      propDepthWeight: 20,
      inlineAllocationWeight: 20,
      contextFanoutWeight: 15,
      effectChurnWeight: 15,
      propDepthThreshold: 3,
      contextFanoutThreshold: 5,
    },
  };
  return { histories, healthScore };
}

describe('enableFileSync', () => {
  let dir: string;
  let target: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'react-insight-sync-'));
    target = join(dir, 'diagnostics.json');
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('flushes immediately and writes valid, schema-conformant JSON', () => {
    const handle = enableFileSync({ path: target, getSnapshot: makeSnapshot });

    handle.flush();

    expect(handle._writeCount()).toBe(1);
    expect(existsSync(target)).toBe(true);

    const parsed = JSON.parse(readFileSync(target, 'utf8'));
    expect(parsed.schemaVersion).toBe('1.0');
    expect(parsed.components).toHaveLength(1);
    expect(parsed.components[0].name).toBe('App');
  });

  it('debounces multiple sync calls into a single write', () => {
    vi.useFakeTimers();
    const handle = enableFileSync({ path: target, getSnapshot: makeSnapshot, debounceMs: 100 });

    handle.sync();
    handle.sync();
    handle.sync();

    expect(handle._writeCount()).toBe(0);

    vi.advanceTimersByTime(100);
    expect(handle._writeCount()).toBe(1);
  });

  it('stop clears a pending write', () => {
    vi.useFakeTimers();
    const handle = enableFileSync({ path: target, getSnapshot: makeSnapshot, debounceMs: 100 });

    handle.sync();
    handle.stop();
    vi.advanceTimersByTime(200);

    expect(handle._writeCount()).toBe(0);
    expect(existsSync(target)).toBe(false);
  });

  it('leaves no partial temp file behind after an atomic write', () => {
    const handle = enableFileSync({ path: target, getSnapshot: makeSnapshot });

    handle.flush();

    const files = readdirSync(dir);
    expect(files.filter(f => f.endsWith('.tmp'))).toHaveLength(0);
    expect(files).toContain('diagnostics.json');
  });
});
