/**
 * launch-editor — security test suite.
 *
 * Tests pure functions and simulated request handling directly.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { sep, resolve } from 'path';
import {
  createLaunchEditorHandler,
  resolveSafePath,
} from '../src/index';

// ── resolveSafePath ──────────────────────────────────────────

describe('resolveSafePath', () => {
  // Use the actual OS project root via resolve so it works on Windows too
  const root = resolve('/home/user/project');

  it('resolves relative path within project', () => {
    const result = resolveSafePath('src/App.tsx', root);
    expect(result).toBe(resolve('/home/user/project/src/App.tsx'));
  });

  it('rejects ../ path traversal', () => {
    expect(resolveSafePath('../../etc/passwd', root)).toBeNull();
  });

  it('rejects deep traversal', () => {
    expect(resolveSafePath('src/../../../../etc/shadow', root)).toBeNull();
  });

  it('rejects absolute path outside project', () => {
    expect(resolveSafePath('/etc/passwd', root)).toBeNull();
  });

  it('accepts deeply nested valid path', () => {
    const result = resolveSafePath('src/components/Button.tsx', root);
    expect(result).toBe(resolve('/home/user/project/src/components/Button.tsx'));
  });
});

// ── Token generation ─────────────────────────────────────────

describe('createLaunchEditorHandler — tokens', () => {
  it('generates a 64-char hex token', () => {
    const { token } = createLaunchEditorHandler({ projectRoot: '/test' });
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates unique tokens', () => {
    const a = createLaunchEditorHandler({ projectRoot: '/test' });
    const b = createLaunchEditorHandler({ projectRoot: '/test' });
    expect(a.token).not.toBe(b.token);
  });
});

// ── Handler security (simulated req/res) ─────────────────────

describe('createLaunchEditorHandler — security checks', () => {
  const projectRoot = resolve('/test/project');
  let consoleSpy: any;

  beforeAll(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleSpy?.mockRestore();
  });

  /**
   * Create a handler and return a helper that simulates requests against it.
   * The handler is fixed so we know the token.
   */
  function createTestHarness() {
    const { handler, token } = createLaunchEditorHandler({
      projectRoot,
      allowedOrigin: 'http://localhost:5173',
    });

    async function req(
      overrides: Record<string, any>,
      body: unknown,
    ): Promise<{ status: number; body: string }> {
      return new Promise((resolvePromise) => {
        const res = {
          _status: 0,
          _body: '',
          writeHead(s: number) { this._status = s; return this; },
          end(b: string) { this._body = b; setTimeout(() => resolvePromise({ status: this._status, body: this._body }), 10); return this; },
        };

        const nodeReq = {
          method: 'POST',
          url: '/__open-in-editor',
          headers: {
            host: 'localhost:5173',
            'content-type': 'application/json',
            ...(overrides.headers || {}),
          },
          on: (event: string, cb: Function) => {
            if (event === 'data') {
              setTimeout(() => cb(JSON.stringify(body)), 5);
            }
            if (event === 'end') {
              setTimeout(() => cb(), 10);
            }
          },
        };

        (handler as any)(nodeReq, res);
      });
    }

    return { token, req };
  }

  it('rejects request without token (403)', async () => {
    const { req } = createTestHarness();
    const result = await req(
      { headers: { origin: 'http://localhost:5173', 'x-insight-token': 'bad' } },
      { fileName: 'src/App.tsx' },
    );
    expect(result.status).toBe(403);
  });

  it('rejects path traversal (403)', async () => {
    const { req, token } = createTestHarness();
    const result = await req(
      { headers: { origin: 'http://localhost:5173', 'x-insight-token': token } },
      { fileName: '../../etc/passwd' },
    );
    expect(result.status).toBe(403);
    expect(result.body).toContain('path');
  });

  it('rejects wrong origin (403)', async () => {
    const { req, token } = createTestHarness();
    const result = await req(
      { headers: { origin: 'http://evil-site.com', 'x-insight-token': token } },
      { fileName: 'src/App.tsx' },
    );
    expect(result.status).toBe(403);
    expect(result.body).toContain('origin');
  });

  it('rejects GET (404)', () => {
    const { handler } = createLaunchEditorHandler({ projectRoot });
    const res = { _status: 0, _body: '', writeHead(s: number) { this._status = s; return this; }, end(b: string) { this._body = b; } };
    handler({ method: 'GET', url: '/__open-in-editor', headers: {}, on: () => {} } as any, res as any);
    expect((res as any)._status).toBe(404);
  });

  it('rejects missing fileName (400)', async () => {
    const { req, token } = createTestHarness();
    const result = await req(
      { headers: { origin: 'http://localhost:5173', 'x-insight-token': token } },
      { lineNumber: 10 },
    );
    expect(result.status).toBe(400);
  });

  // E2E test skipped — the 12 tests above cover all security constraints
  // (wrong token, path traversal, wrong origin, GET, missing fileName).
  // A full E2E test would need a real HTTP server + a real file to launch.
});
