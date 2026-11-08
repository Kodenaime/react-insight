import { describe, it, expect } from 'vitest';
import {
  assertLoopbackHost,
  verifyToken,
  validateOrigin,
  verifyHandshake,
} from '../src/security';
import { createBridgeHandler } from '../src/bridge';
import { generateToken } from '../src/token';
import type { BridgeSnapshot } from '../src/types';

function makeSnapshot(): BridgeSnapshot {
  return {
    report: {
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      appHealthScore: 100,
      components: [],
    },
    healthScore: { score: 100, metrics: [] },
  };
}

describe('assertLoopbackHost', () => {
  it('allows 127.0.0.1', () => {
    expect(() => assertLoopbackHost('127.0.0.1')).not.toThrow();
  });

  it('allows ::1', () => {
    expect(() => assertLoopbackHost('::1')).not.toThrow();
  });

  it('rejects 0.0.0.0', () => {
    expect(() => assertLoopbackHost('0.0.0.0')).toThrow(/loopback/);
  });

  it('rejects non-loopback hosts', () => {
    expect(() => assertLoopbackHost('192.168.1.10')).toThrow(/loopback/);
    expect(() => assertLoopbackHost('example.com')).toThrow(/loopback/);
  });
});

describe('createBridgeHandler — non-loopback bind refusal', () => {
  it('throws when configured with 0.0.0.0', () => {
    expect(() =>
      createBridgeHandler({ host: '0.0.0.0', token: 'a'.repeat(64) }),
    ).toThrow(/loopback/);
  });
});

describe('verifyToken', () => {
  const token = generateToken();

  it('accepts a matching token', () => {
    expect(verifyToken(token, token)).toBe(true);
  });

  it('rejects a mismatched token', () => {
    expect(verifyToken('b'.repeat(64), token)).toBe(false);
  });

  it('rejects a missing token', () => {
    expect(verifyToken(undefined, token)).toBe(false);
  });

  it('rejects an empty token', () => {
    expect(verifyToken('', token)).toBe(false);
  });
});

describe('validateOrigin', () => {
  const allowed = 'http://localhost:5173';

  it('accepts the expected origin', () => {
    expect(validateOrigin(allowed, allowed)).toBe(true);
  });

  it('rejects a mismatched origin', () => {
    expect(validateOrigin('http://evil.example', allowed)).toBe(false);
  });

  it('rejects a missing origin when one is required', () => {
    expect(validateOrigin(undefined, allowed)).toBe(false);
  });

  it('allows any origin when unrestricted', () => {
    expect(validateOrigin(undefined, undefined)).toBe(true);
  });
});

describe('verifyHandshake', () => {
  const token = 'f'.repeat(64);
  const origin = 'http://localhost:5173';

  it('accepts valid token + origin', () => {
    expect(
      verifyHandshake({ token, origin, expectedToken: token, allowedOrigin: origin }).ok,
    ).toBe(true);
  });

  it('rejects a missing token', () => {
    expect(
      verifyHandshake({ token: undefined, origin, expectedToken: token, allowedOrigin: origin }).reason,
    ).toBe('missing_token');
  });

  it('rejects a mismatched token', () => {
    expect(
      verifyHandshake({ token: 'wrong', origin, expectedToken: token, allowedOrigin: origin }).reason,
    ).toBe('invalid_token');
  });

  it('rejects a mismatched origin', () => {
    expect(
      verifyHandshake({ token, origin: 'http://evil.example', expectedToken: token, allowedOrigin: origin }).reason,
    ).toBe('invalid_origin');
  });
});

describe('bridge handler — simulated HTTP', () => {
  const token = 'c'.repeat(64);
  const origin = 'http://localhost:5173';

  function simulate(
    handler: ReturnType<typeof createBridgeHandler>['handler'],
    opts: { method: string; url: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; body: string }> {
    return new Promise(resolve => {
      const res: any = {
        _status: 0,
        _body: '',
        _headers: {} as Record<string, string>,
        setHeader(k: string, v: string) {
          this._headers[k] = v;
          return this;
        },
        writeHead(s: number, h?: Record<string, string>) {
          this._status = s;
          if (h) Object.assign(this._headers, h);
          return this;
        },
        end(b?: string) {
          this._body = b ?? '';
          setTimeout(() => resolve({ status: this._status, body: this._body }), 0);
          return this;
        },
      };

      const req: any = {
        method: opts.method,
        url: opts.url,
        headers: opts.headers ?? {},
        on: (event: string, cb: (...args: any[]) => void) => {
          if (event === 'data' && opts.body) {
            setTimeout(() => cb(Buffer.from(opts.body!)), 0);
          }
          if (event === 'end') {
            setTimeout(() => cb(), 0);
          }
        },
      };

      handler(req, res);
    });
  }

  it('rejects a POST with a missing token (403)', async () => {
    const bridge = createBridgeHandler({ token, allowedOrigin: origin });
    const result = await simulate(bridge.handler, {
      method: 'POST',
      url: '/snapshot',
      headers: { origin },
      body: JSON.stringify({ snapshot: makeSnapshot() }),
    });
    expect(result.status).toBe(403);
  });

  it('rejects a POST with a mismatched token (403)', async () => {
    const bridge = createBridgeHandler({ token, allowedOrigin: origin });
    const result = await simulate(bridge.handler, {
      method: 'POST',
      url: '/snapshot',
      headers: { origin },
      body: JSON.stringify({ token: 'wrong', snapshot: makeSnapshot() }),
    });
    expect(result.status).toBe(403);
  });

  it('rejects a POST with a mismatched origin (403)', async () => {
    const bridge = createBridgeHandler({ token, allowedOrigin: origin });
    const result = await simulate(bridge.handler, {
      method: 'POST',
      url: '/snapshot',
      headers: { origin: 'http://evil.example' },
      body: JSON.stringify({ token, snapshot: makeSnapshot() }),
    });
    expect(result.status).toBe(403);
  });

  it('accepts a well-formed authorized POST (200)', async () => {
    const bridge = createBridgeHandler({ token, allowedOrigin: origin });
    const result = await simulate(bridge.handler, {
      method: 'POST',
      url: '/snapshot',
      headers: { origin },
      body: JSON.stringify({ token, snapshot: makeSnapshot() }),
    });
    expect(result.status).toBe(200);
    expect(bridge.getLatestSnapshot()).not.toBeNull();
  });

  it('rejects non-snapshot paths (404)', async () => {
    const bridge = createBridgeHandler({ token, allowedOrigin: origin });
    const result = await simulate(bridge.handler, {
      method: 'POST',
      url: '/other',
      headers: { origin },
      body: JSON.stringify({ token, snapshot: makeSnapshot() }),
    });
    expect(result.status).toBe(404);
  });
});
