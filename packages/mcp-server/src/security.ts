/**
 * Pure security helpers for the bridge. These mirror launch-editor's constraints
 * and are kept free of transport concerns so they can be unit-tested directly.
 */

import { timingSafeEqual } from 'crypto';

/** Loopback addresses we permit for the bridge listener. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);

/**
 * Refuse any non-loopback bind. This is the same rule as launch-editor: the
 * endpoint must never be reachable from another device on the network.
 */
export function assertLoopbackHost(host: string): void {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `Refusing to bind to non-loopback host: ${host}. Only 127.0.0.1 or ::1 are allowed.`,
    );
  }
}

/**
 * Constant-time token comparison. Rejects missing, empty, or non-string values.
 */
export function verifyToken(presented: string | undefined | null, expected: string): boolean {
  if (!presented || typeof presented !== 'string' || presented.length === 0) {
    return false;
  }
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Validate the browser `Origin` header against the expected dev-server origin.
 * When no origin is configured, validation is intentionally skipped (opt-in).
 */
export function validateOrigin(
  origin: string | undefined,
  allowedOrigin: string | undefined,
): boolean {
  if (!allowedOrigin) return true;
  if (!origin) return false;
  return origin === allowedOrigin;
}

export interface HandshakeInput {
  token: string | undefined | null;
  origin: string | undefined;
  expectedToken: string;
  allowedOrigin?: string;
}

export interface HandshakeResult {
  ok: boolean;
  reason?: 'missing_token' | 'invalid_token' | 'invalid_origin';
}

/**
 * Validate a single bridge message (origin + token). Every push must pass this.
 */
export function verifyHandshake(input: HandshakeInput): HandshakeResult {
  if (!validateOrigin(input.origin, input.allowedOrigin)) {
    return { ok: false, reason: 'invalid_origin' };
  }
  if (!input.token) {
    return { ok: false, reason: 'missing_token' };
  }
  if (!verifyToken(input.token, input.expectedToken)) {
    return { ok: false, reason: 'invalid_token' };
  }
  return { ok: true };
}
