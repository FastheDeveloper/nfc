/**
 * Why this project wrote its own NFC layer — as executable assertions.
 *
 * `react-native-nfc-manager` was removed in Phase 4 T10. These tests run
 * against a **vendored copy** kept solely as evidence
 * (`vendor/react-native-nfc-manager/`), because the argument for Phase 4 should
 * be something a reader can run rather than a claim in a document.
 *
 * Two findings, both discovered by reading the package rather than by hitting
 * them in production:
 *
 *   1. Every error class carries an empty message (DEVLOG §1.13).
 *   2. The text decoder is lossy in three separate ways (DEVLOG §2.3, asserted
 *      in `lib/ndef.test.ts` alongside our own decoder).
 *
 * If a future version of the package fixes any of this, these tests fail — and
 * that is the signal to re-open the question rather than a nuisance.
 */
import { describe, expect, it } from '@jest/globals';

/* eslint-disable @typescript-eslint/no-require-imports */
const NfcError = require('../vendor/react-native-nfc-manager/NfcError');
const util = require('../vendor/react-native-nfc-manager/ndef-lib/util');
const ndefText = require('../vendor/react-native-nfc-manager/ndef-lib/ndef-text');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('§1.13 — the errors carry no message', () => {
  /**
   * This is the defect that made a failed scan render as *nothing*: the Phase 1
   * screen did `setError(err.message)`, React treated `''` as falsy, and the
   * error card never appeared. The meaning lives in the class alone.
   */
  it('every error class is constructed with an empty message', () => {
    const classes = [
      'UserCancel',
      'Timeout',
      'TagConnectionLost',
      'SystemBusy',
      'RadioDisabled',
      'TagNotWritable',
      'TagSizeTooSmall',
      'TagUpdateFailure',
      'FirstNdefInvalid',
    ];

    for (const name of classes) {
      const instance = new NfcError[name]();

      expect(instance).toBeInstanceOf(Error);
      expect(instance.message).toBe('');
    }
  });

  it('so the meaning is recoverable only from the class', () => {
    const cancelled = new NfcError.UserCancel();

    expect(cancelled.message).toBe('');
    expect(cancelled instanceof NfcError.UserCancel).toBe(true);
  });

  /**
   * Our replacement, by contrast, carries a code *and* a message across the
   * bridge — see `modules/nfc-native/ios/NfcExceptions.swift`. That is the
   * concrete improvement, not a stylistic preference.
   */
  it('which is exactly what our own exceptions do not do', () => {
    // Reproduces the shape observed on device, verbatim.
    const ours = Object.assign(
      new Error(
        "Calling the 'readTag' function has failed → Caused by: UserCancelledException: The scan was cancelled."
      ),
      { code: 'ERR_USER_CANCELLED' }
    );

    expect(ours.message).not.toBe('');
    expect(ours.code).toBeTruthy();
  });
});

describe('§2.3 — the byte-to-string helper truncates', () => {
  const utf8 = (s: string) => Array.from(Buffer.from(s, 'utf8'));

  it('turns U+1F600 into U+F600, a Private Use Area character', () => {
    const decoded = util.bytesToString(utf8('hi 😀'));

    expect(decoded).not.toBe('hi 😀');
    expect([...decoded].map((c) => c.codePointAt(0))).toContain(0xf600);
  });

  it('handles 3-byte sequences correctly — the bug is astral-plane only', () => {
    expect(util.bytesToString(utf8('日本語'))).toBe('日本語');
  });

  it('discards the language code it just measured', () => {
    // 0x02 = UTF-8, 2-byte language code; then "en", then "Hi".
    const payload = [0x02, ...utf8('en'), ...utf8('Hi')];

    // Returns a bare string: there is no way to recover "en" from it.
    expect(ndefText.decodePayload(payload)).toBe('Hi');
  });

  it('ignores the UTF-16 flag in the status byte', () => {
    // 0x82 sets the high bit — the body is UTF-16BE "Hi".
    const payload = [0x82, ...utf8('en'), 0x00, 0x48, 0x00, 0x69];

    expect(ndefText.decodePayload(payload)).not.toBe('Hi');
  });
});
