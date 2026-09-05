import { describe, expect, it } from '@jest/globals';
import * as NfcError from 'react-native-nfc-manager/src/NfcError';

import { isCancellation, toScanError } from './scanError';

describe('the bug this module exists to fix', () => {
  /**
   * The Phase 1 screen did `setError(e.message)`. This is why nothing appeared.
   */
  it('every library error has an empty message', () => {
    const classes = [
      NfcError.UserCancel,
      NfcError.Timeout,
      NfcError.TagConnectionLost,
      NfcError.SystemBusy,
      NfcError.RadioDisabled,
    ];

    for (const Cls of classes) {
      expect(new Cls().message).toBe('');
    }
  });

  it('so every mapped error still produces a title and a detail', () => {
    const mapped = toScanError(new NfcError.Timeout());

    expect(mapped.title).toBeTruthy();
    expect(mapped.detail).toBeTruthy();
  });
});

describe('cancellation', () => {
  it('is recognised', () => {
    expect(isCancellation(new NfcError.UserCancel())).toBe(true);
  });

  it('is not confused with other failures', () => {
    expect(isCancellation(new NfcError.Timeout())).toBe(false);
    expect(isCancellation(new Error('boom'))).toBe(false);
    expect(isCancellation(undefined)).toBe(false);
  });

  it('is the one kind observed on hardware, so it is not provisional', () => {
    expect(toScanError(new NfcError.UserCancel())).toMatchObject({
      kind: 'cancelled',
      provisional: false,
    });
  });
});

describe('reaching the same class from both platforms', () => {
  /**
   * iOS returns the string `NFCError:200`; Android returns the literal
   * `'cancelled'`. Different native worlds, one JS class — one of the few
   * places the library hides a platform difference instead of leaking it.
   */
  it('iOS NFCError:200 and Android "cancelled" both become UserCancel', () => {
    const fromIos = NfcError.buildNfcExceptionIOS('NFCError:200');
    const fromAndroid = NfcError.buildNfcExceptionAndroid('cancelled');

    expect(isCancellation(fromIos)).toBe(true);
    expect(isCancellation(fromAndroid)).toBe(true);
    expect(toScanError(fromIos).kind).toBe(toScanError(fromAndroid).kind);
  });
});

describe('classification', () => {
  it.each([
    [new NfcError.Timeout(), 'timeout'],
    [new NfcError.TagConnectionLost(), 'connection-lost'],
    [new NfcError.TagNotConnected(), 'connection-lost'],
    [new NfcError.RetryExceeded(), 'connection-lost'],
    [new NfcError.SessionInvalidated(), 'connection-lost'],
    [new NfcError.SystemBusy(), 'system-busy'],
    [new NfcError.RadioDisabled(), 'nfc-off'],
    [new NfcError.UnsupportedFeature(), 'unsupported'],
    [new NfcError.FirstNdefInvalid(), 'not-ndef'],
  ])('maps %o', (error, kind) => {
    expect(toScanError(error).kind).toBe(kind);
  });

  it('falls back to unknown for an unrecognised error', () => {
    expect(toScanError(new Error('something else')).kind).toBe('unknown');
  });

  it('survives a thrown non-Error', () => {
    const mapped = toScanError('a bare string');

    expect(mapped.kind).toBe('unknown');
    expect(mapped.developer).toContain('a bare string');
  });

  it('everything except cancellation is flagged provisional until observed', () => {
    const kinds = [new NfcError.Timeout(), new NfcError.SystemBusy(), new Error('x')];

    for (const error of kinds) {
      expect(toScanError(error).provisional).toBe(true);
    }
  });
});

describe('the Android unformatted-tag path (provisional — task H1)', () => {
  /**
   * Android reports this as text inside a bare NfcErrorBase rather than as a
   * code. The hint list is a guess from the Android source and has never been
   * seen on a device, so it must stay flagged.
   */
  it('matches a message that mentions Ndef', () => {
    const error = new NfcError.NfcErrorBase('No Ndef technology on this tag');

    expect(toScanError(error)).toMatchObject({ kind: 'not-ndef', provisional: true });
  });

  it('does not swallow an unrelated message', () => {
    expect(toScanError(new NfcError.NfcErrorBase('disk on fire')).kind).toBe('unknown');
  });
});

describe('developer detail', () => {
  it('states the empty message explicitly rather than printing nothing', () => {
    const mapped = toScanError(new NfcError.UserCancel());

    expect(mapped.developer).toContain('NfcError.UserCancel');
    expect(mapped.developer).toContain('message: "" (empty)');
  });

  it('uses a hardcoded class name so minification cannot corrupt it', () => {
    // Simulates a release build where the class name has been mangled.
    class Mangled extends NfcError.Timeout {}
    Object.defineProperty(Mangled, 'name', { value: 'a' });

    expect(toScanError(new Mangled()).developer).toContain('NfcError.Timeout');
  });

  it('shows a real message when there is one', () => {
    expect(toScanError(new NfcError.NfcErrorBase('disk on fire')).developer).toContain(
      'message: disk on fire'
    );
  });
});
