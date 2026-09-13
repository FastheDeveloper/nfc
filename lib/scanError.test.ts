import { describe, expect, it } from '@jest/globals';

import { isCancellation, toScanError } from './scanError';

/**
 * `react-native-nfc-manager` was removed in T10, and with it the tests that
 * mapped its error classes. What those tests *proved* — that every one of them
 * carries an empty message — survives in `lib/vendorEvidence.test.ts`, running
 * against the vendored copy.
 *
 * What remains here is the surface the app actually uses: our own module's
 * exceptions, and the pre-flight refusal we raise ourselves.
 */

// ---------------------------------------------------------------------------
// Our own native module (Phase 4)
// ---------------------------------------------------------------------------

/**
 * Errors from our Swift arrive as Expo-wrapped values, not class instances —
 * there is no `instanceof` across the bridge. These fixtures reproduce the
 * exact shape observed on iPhone "Fas" (§T1a).
 */
const wrapped = (code: string, message: string) =>
  new Error(`Calling the 'readTag' function has failed → Caused by: ${code}: ${message}`);

describe('native module errors map onto the same surface', () => {
  it.each([
    ['UserCancelledException', 'cancelled'],
    ['TimeoutException', 'timeout'],
    ['SystemBusyException', 'system-busy'],
    ['ConnectFailedException', 'connection-lost'],
    ['StatusFailedException', 'connection-lost'],
    ['SessionFailedException', 'connection-lost'],
    ['NotNdefException', 'not-ndef'],
    ['NfcUnavailableException', 'unsupported'],
    ['TagReadOnlyException', 'read-only'],
    ['TagTooSmallException', 'too-big-for-tag'],
    ['WriteFailedException', 'write-failed'],
    ['InvalidMessageException', 'write-failed'],
  ])('%s → %s', (code, kind) => {
    expect(toScanError(wrapped(code, 'something')).kind).toBe(kind);
  });

  it('a cancel is a cancellation, not a failure', () => {
    const fromNative = toScanError(wrapped('UserCancelledException', 'The scan was cancelled.'));

    expect(fromNative.kind).toBe('cancelled');
    expect(fromNative.provisional).toBe(false);
  });

  it('prefers the native message, which carries real numbers', () => {
    const error = wrapped(
      'TagTooSmallException',
      'Too big for this tag: the tag reports 137 bytes and this needs 202. Nothing was written.'
    );

    expect(toScanError(error).detail).toContain('137');
    expect(toScanError(error).detail).toContain('202');
  });

  it('keeps the whole cause chain in developer detail', () => {
    const developer = toScanError(wrapped('TimeoutException', 'timed out')).developer;

    expect(developer).toContain('TimeoutException');
    expect(developer).toContain('↳');
  });

  it('flags unobserved native mappings as provisional', () => {
    expect(toScanError(wrapped('UserCancelledException', 'x')).provisional).toBe(false);
    expect(toScanError(wrapped('TimeoutException', 'x')).provisional).toBe(true);
  });

  it('falls through to unknown for a code we do not recognise', () => {
    expect(toScanError(wrapped('SomethingNewException', 'x')).kind).toBe('unknown');
  });

  it('does not mistake a plain Error for a native exception', () => {
    expect(toScanError(new Error('ordinary failure')).kind).toBe('unknown');
  });
});

describe('isCancellation', () => {
  it('recognises our native code across the bridge', () => {
    expect(isCancellation(wrapped('UserCancelledException', 'The scan was cancelled.'))).toBe(true);
  });

  it('still says no to everything else', () => {
    expect(isCancellation(wrapped('TimeoutException', 'x'))).toBe(false);
    expect(isCancellation(new Error('boom'))).toBe(false);
    expect(isCancellation(null)).toBe(false);
  });
});

describe('the T9 cancel regression', () => {
  /**
   * Reproduces exactly what the device produced: Expo sets `code` to its own
   * derived `ERR_USER_CANCELLED`, while the class name lives in the cause
   * chain. Matching only on the class name missed it, and a cancelled scan
   * rendered "Could not read the tag".
   */
  const realCancel = Object.assign(
    new Error(
      "Calling the 'readTag' function has failed → Caused by: UserCancelledException: The scan was cancelled."
    ),
    { code: 'ERR_USER_CANCELLED' }
  );

  it('is recognised as a cancellation, so nothing is rendered', () => {
    expect(isCancellation(realCancel)).toBe(true);
  });

  it('maps to cancelled rather than unknown', () => {
    expect(toScanError(realCancel).kind).toBe('cancelled');
  });

  it('is still recognised if Expo ever stops setting a code', () => {
    const noCode = new Error(
      "Calling the 'readTag' function has failed → Caused by: UserCancelledException: cancelled"
    );

    expect(isCancellation(noCode)).toBe(true);
  });

  it('matches other exceptions by their derived code too', () => {
    const timeout = Object.assign(new Error('failed → Caused by: X: timed out'), {
      code: 'ERR_TIMEOUT',
    });

    expect(toScanError(timeout).kind).toBe('timeout');
  });
});
