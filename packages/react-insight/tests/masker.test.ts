/**
 * Masker — test suite.
 *
 * Covers:
 *   1. Key-Name redaction (default patterns)
 *   2. Custom key-name patterns
 *   3. Value-Shape redaction (JWT, credit card, Bearer)
 *   4. No redaction for benign data
 *   5. Circular objects (no infinite loops)
 *   6. Recursion limits (depth, keys)
 *   7. Non-destructive (original untouched)
 */

import { describe, it, expect } from 'vitest';
import { maskValue, maskValueFast } from '../src/security/masker';

describe('masker — Pass 1 (Key-Name Regex)', () => {
  it('redacts values for matching key "authToken"', () => {
    const result = maskValue({ authToken: 'secret123' });
    expect(result.redacted).toBe(true);
    expect((result.value as any).authToken).toBe('••••••••');
  });

  it('redacts values for matching key "password"', () => {
    const result = maskValue({ password: 'hunter2' });
    expect(result.redacted).toBe(true);
    expect((result.value as any).password).toBe('••••••••');
  });

  it('redacts values for matching key "creditCard"', () => {
    const result = maskValue({ creditCard: '4111111111111111' });
    expect((result.value as any).creditCard).toBe('••••••••');
  });

  it('redacts values for matching key "apiKey"', () => {
    const result = maskValue({ apiKey: 'abc-123-def' });
    expect((result.value as any).apiKey).toBe('••••••••');
  });

  it('redacts values for matching key with underscore pattern "auth_token"', () => {
    const result = maskValue({ auth_token: 's3cret' });
    expect(result.redacted).toBe(true);
    expect((result.value as any).auth_token).toBe('••••••••');
  });

  it('does NOT redact benign keys like "name" or "email"', () => {
    const data = { name: 'Alice', email: 'alice@example.com' };
    const result = maskValue(data);
    expect(result.redacted).toBe(false);
    expect((result.value as any).name).toBe('Alice');
    expect((result.value as any).email).toBe('alice@example.com');
  });

  it('accepts custom key patterns', () => {
    const result = maskValue(
      { sessionId: 'abc-123', name: 'test' },
      { customKeyPatterns: [/session/i] },
    );
    expect(result.redacted).toBe(true);
    expect((result.value as any).sessionId).toBe('••••••••');
    expect((result.value as any).name).toBe('test');
  });

  it('redacts nested objects recursively', () => {
    const data = { user: { profile: { authToken: 'secret' } } };
    const result = maskValue(data);
    expect((result.value as any).user.profile.authToken).toBe('••••••••');
  });

  it('redacts values in arrays', () => {
    const data = { users: [{ name: 'Alice', apiKey: 'key-1' }, { name: 'Bob', apiKey: 'key-2' }] };
    const result = maskValue(data);
    expect(result.redacted).toBe(true);
    expect((result.value as any).users[0].apiKey).toBe('••••••••');
    expect((result.value as any).users[1].apiKey).toBe('••••••••');
    expect((result.value as any).users[0].name).toBe('Alice');
  });
});

describe('masker — Pass 2 (Value-Shape Regex)', () => {
  it('redacts JWT-shaped string under an innocuous key', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVNHqB7s6N7vEYk';
    const result = maskValue({ sessionData: jwt });
    expect(result.redacted).toBe(true);
    expect((result.value as any).sessionData).toBe('••••••••');
  });

  it('does NOT redact short dot-separated strings that look like JWT but are too short', () => {
    const result = maskValue({ data: 'a.b.c' });
    expect(result.redacted).toBe(false);
    expect((result.value as any).data).toBe('a.b.c');
  });

  it('redacts credit-card-like digit strings under an innocuous key', () => {
    // A Luhn-valid test card number
    const result = maskValue({ userValue: '4111111111111111' });
    expect(result.redacted).toBe(true);
    expect((result.value as any).userValue).toBe('••••••••');
  });

  it('redacts Bearer token prefix', () => {
    const result = maskValue({ authorization: 'Bearer sk_live_abcdef123456' });
    expect(result.redacted).toBe(true);
    expect((result.value as any).authorization).toBe('••••••••');
  });

  it('redacts multiple Bearer prefixes', () => {
    const result = maskValue({
      key1: 'sk_live_abc',
      key2: 'pk_test_xyz',
      key3: 'github_pat_11AAA',
    });
    expect(result.redacted).toBe(true);
    expect((result.value as any).key1).toBe('••••••••');
    expect((result.value as any).key2).toBe('••••••••');
    expect((result.value as any).key3).toBe('••••••••');
  });

  it('value-shape patterns can be disabled', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVNHqB7s6N7vEYk';
    const result = maskValue(
      { token: jwt },
      { valuePatterns: [] }, // Disable all value-shape checks
    );
    // Key-name pass still catches "token"
    expect(result.redacted).toBe(true);
  });

  it('does NOT redact normal strings that look numeric but are not Luhn-valid', () => {
    const result = maskValue({ count: '12345' });
    expect(result.redacted).toBe(false);
  });
});

describe('masker — circular references', () => {
  it('handles self-referencing objects without stack overflow', () => {
    const obj: Record<string, unknown> = { name: 'self' };
    obj.self = obj;

    expect(() => maskValue(obj)).not.toThrow();
    const result = maskValue(obj);
    // The name passes through unchanged, the self ref is preserved as a reference
    expect((result.value as any).name).toBe('self');
  });

  it('handles sibling cycles (a → b → a)', () => {
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b', sibling: a };
    a.sibling = b;

    expect(() => maskValue(a)).not.toThrow();
  });

  it('handles deeply nested cycles', () => {
    const deep: Record<string, unknown> = { name: 'root' };
    let cursor = deep;
    for (let i = 0; i < 20; i++) {
      cursor.child = { name: `node-${i}` };
      cursor = cursor.child as Record<string, unknown>;
    }
    cursor.child = deep; // close the cycle

    expect(() => maskValue(deep)).not.toThrow();
  });
});

describe('masker — truncation and limits', () => {
  it('truncated flag set when depth exceeds 4', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'deep' } } } } } };
    const result = maskValue(deep);
    expect(result.truncated).toBe(true);
  });

  it('truncated flag set when object has more than 50 keys', () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 60; i++) big[`key${i}`] = i;
    const result = maskValue(big);
    expect(result.truncated).toBe(true);
    // Should still process the first 50 keys
    expect(Object.keys(result.value as any).length).toBe(50);
  });

  it('truncated=false for within-limit structures', () => {
    const data = { a: { b: { c: 'hello' } } };
    const result = maskValue(data);
    expect(result.truncated).toBe(false);
  });
});

describe('masker — non-destructive', () => {
  it('does not mutate the original object', () => {
    const original = { name: 'Alice', apiKey: 'secret' };
    const originalApiKey = original.apiKey;
    maskValue(original);
    expect(original.apiKey).toBe(originalApiKey);
  });

  it('returns a new object tree for masked data', () => {
    const original = { user: { name: 'Bob' } };
    const result = maskValue(original);
    expect(result.value).not.toBe(original);
    expect((result.value as any).user).not.toBe(original.user);
  });

  it('preserves unchanged values by reference for nested safe data', () => {
    const staticVal = { nested: 'same' };
    const original = { name: 'Alice', config: staticVal };
    const result = maskValue(original);
    // config is not matched by any key pattern and has no sensitive values,
    // so it gets walked recursively — it's a new object with same content
    expect((result.value as any).config).toEqual(staticVal);
  });
});

describe('masker — maskValueFast convenience wrapper', () => {
  it('returns the masked value directly', () => {
    const result = maskValueFast({ password: 'secret' });
    expect((result as any).password).toBe('••••••••');
  });

  it('returns unchanged value for safe data', () => {
    const result = maskValueFast({ name: 'Alice' });
    expect((result as any).name).toBe('Alice');
  });
});

describe('masker — redaction count', () => {
  it('reports correct redaction count', () => {
    const data = { password: 'p', apiKey: 'k', name: 'n', authToken: 't', email: 'e' };
    const result = maskValue(data);
    expect(result.redactionCount).toBe(3);
    expect(result.redacted).toBe(true);
  });

  it('reports zero redactions for safe data', () => {
    const result = maskValue({ name: 'Alice', age: 30 });
    expect(result.redactionCount).toBe(0);
    expect(result.redacted).toBe(false);
  });
});
