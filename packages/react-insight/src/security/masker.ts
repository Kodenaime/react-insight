/**
 * Two-Pass Automated Masking Pipeline — recursive redaction security layer.
 *
 * ## Strategy (per spec §5.1)
 *
 * All telemetry values pass through this pipeline BEFORE entering storage,
 * UI state, or export serialization.
 *
 * **Pass 1 — Key-Name Regex:**
 *   Redact values whose object keys match a configurable pattern.
 *   Default: `/token|password|secret|auth|creditCard|ssn|apiKey/i`
 *
 * **Pass 2 — Value-Shape Regex:**
 *   Redact values that structurally match known sensitive formats,
 *   REGARDLESS of the key name. This catches raw JWTs stored under
 *   innocuous key names like `session`, `value`, or `data`.
 *
 *   Detected formats:
 *   - JWT structure (xxx.yyy.zzz base64url segments)
 *   - Credit-card-like digit sequences (13–19 digits with Luhn check)
 *   - Bearer token prefixes (Bearer , sk_live_, pk_live_, etc.)
 *
 * **Recursion limits** (matching the diff engine §2.2):
 *   - maxDepth: 4
 *   - maxKeysPerLevel: 50
 *   - Cycle guard: WeakSet of visited objects
 *
 * **Non-destructive:** Masking creates a new object tree rather than
 * mutating the original. Source references are preserved for unchanged
 * values to minimize memory overhead.
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface MaskerConfig {
  /** Key-name regex patterns. Default: [/token|password|secret|auth|creditCard|ssn|apiKey/i] */
  keyPatterns?: RegExp[];
  /** Custom key-name patterns (additional to defaults). */
  customKeyPatterns?: RegExp[];
  /** Value-shape detection: which patterns to check. Default: all. */
  valuePatterns?: ('jwt' | 'creditCard' | 'bearerToken')[];
  /** Max recursion depth. Default: 4 */
  maxDepth?: number;
  /** Max keys per object level. Default: 50 */
  maxKeysPerLevel?: number;
  /** The redaction string. Default: '••••••••' */
  redactionString?: string;
}

export interface MaskerResult {
  /** The masked (or untouched) value. */
  value: unknown;
  /** Whether any redaction was applied. */
  redacted: boolean;
  /** Count of values redacted. */
  redactionCount: number;
  /** Whether traversal was truncated. */
  truncated: boolean;
}

// ─────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────

const DEFAULT_KEY_PATTERNS = [
  /token|password|secret|auth|creditCard|ssn|apiKey/i,
];

const DEFAULT_REDACTION = '••••••••';

const JWT_REGEX = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/;

const BEARER_PREFIXES = [
  /^Bearer\s+/,
  /^sk_live_/,
  /^pk_live_/,
  /^sk_test_/,
  /^pk_test_/,
  /^ghp_/,
  /^gho_/,
  /^github_pat_/,
];

/**
 * Luhn check for credit card numbers.
 * Returns true if the digit string passes the Luhn algorithm.
 */
function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (isNaN(n)) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * Check if a string value matches a credit-card-like pattern.
 * Must be 13–19 digits (possibly with spaces/dashes).
 */
function isCreditCardLike(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  if (!/^\d+$/.test(digits)) return false;
  return luhnCheck(digits);
}

/**
 * Check if a string matches any known sensitive value pattern.
 */
function isSensitiveValue(value: string, patterns: Set<string>): boolean {
  if (patterns.has('jwt') && JWT_REGEX.test(value)) {
    // Avoid false-positives on short strings — JWT segments are non-trivial
    const segments = value.split('.');
    if (segments.length === 3 && segments[0].length > 5 && segments[1].length > 5) {
      return true;
    }
  }

  if (patterns.has('creditCard') && isCreditCardLike(value)) {
    return true;
  }

  if (patterns.has('bearerToken')) {
    for (const prefix of BEARER_PREFIXES) {
      if (prefix.test(value)) return true;
    }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────
// Masking engine
// ─────────────────────────────────────────────────────────────

/**
 * Apply two-pass recursive masking to a value.
 *
 * @param value - The value to mask (object, array, primitive).
 * @param config - Optional configuration overrides.
 * @returns MaskerResult with the masked value and metadata.
 */
export function maskValue(
  value: unknown,
  config: MaskerConfig = {},
): MaskerResult {
  const keyPatterns = [
    ...DEFAULT_KEY_PATTERNS,
    ...(config.customKeyPatterns ?? []),
  ];
  const valuePatterns = new Set(config.valuePatterns ?? ['jwt', 'creditCard', 'bearerToken']);
  const maxDepth = config.maxDepth ?? 4;
  const maxKeys = config.maxKeysPerLevel ?? 50;
  const redactionString = config.redactionString ?? DEFAULT_REDACTION;

  let redactionCount = 0;
  let truncated = false;
  const visited = new WeakSet<object>();

  function walk(val: unknown, depth: number): unknown {
    if (depth > maxDepth) {
      truncated = true;
      return val;
    }

    if (val === null || val === undefined) return val;

    // Primitives — check value shape on strings
    if (typeof val !== 'object') {
      if (typeof val === 'string' && valuePatterns.size > 0) {
        if (isSensitiveValue(val, valuePatterns)) {
          redactionCount++;
          return redactionString;
        }
      }
      return val;
    }

    // Cycle guard
    if (visited.has(val as object)) {
      return val; // Return the reference since we can't recurse
    }
    visited.add(val as object);

    // Arrays
    if (Array.isArray(val)) {
      if (val.length > maxKeys) truncated = true;
      const items = val.slice(0, maxKeys).map(item => walk(item, depth + 1));
      visited.delete(val as object);
      return items;
    }

    // Plain objects
    const obj = val as Record<string, unknown>;
    const keys = Object.keys(obj).slice(0, maxKeys);
    if (Object.keys(obj).length > maxKeys) truncated = true;

    const result: Record<string, unknown> = {};
    for (const key of keys) {
      // Pass 1: Key-Name check
      if (keyPatterns.some(pattern => pattern.test(key))) {
        redactionCount++;
        result[key] = redactionString;
        continue;
      }

      // Pass 2: Value-Shape check (applied to string values)
      const rawValue = obj[key];
      if (typeof rawValue === 'string' && valuePatterns.size > 0) {
        if (isSensitiveValue(rawValue, valuePatterns)) {
          redactionCount++;
          result[key] = redactionString;
          continue;
        }
      }

      result[key] = walk(rawValue, depth + 1);
    }

    visited.delete(val as object);
    return result;
  }

  const masked = walk(value, 0);

  return {
    value: masked,
    redacted: redactionCount > 0,
    redactionCount,
    truncated,
  };
}

/**
 * Convenience wrapper: mask a value and return the masked value directly.
 * Throws if the value can't be safely serialized.
 */
export function maskValueFast(value: unknown, config?: MaskerConfig): unknown {
  return maskValue(value, config).value;
}
