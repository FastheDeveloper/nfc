import { describe, expect, it } from '@jest/globals';

import { describeNativeError, expoCodeFor } from './nativeError';

/** Verbatim shape observed on iPhone "Fas", 2026-09-05. */
const WRAPPED = new Error(
  "Calling the 'openNfcSettings' function has failed → Caused by: NoNfcSettingsException: " +
    'iOS has no NFC setting to open. NFC is available whenever the hardware supports it.'
);

describe('describeNativeError', () => {
  it('digs our sentence out from under the framework wrapper', () => {
    expect(describeNativeError(WRAPPED).message).toBe(
      'iOS has no NFC setting to open. NFC is available whenever the hardware supports it.'
    );
  });

  it('recovers the exception class as the code', () => {
    expect(describeNativeError(WRAPPED).code).toBe('NoNfcSettingsException');
  });

  it('keeps the whole chain for developer detail', () => {
    const { chain } = describeNativeError(WRAPPED);

    expect(chain).toHaveLength(2);
    expect(chain[0]).toContain("Calling the 'openNfcSettings' function has failed");
  });

  it('prefers an explicit code when Expo supplies one', () => {
    const coded = Object.assign(new Error('boom'), { code: 'ERR_NFC' });

    expect(describeNativeError(coded).code).toBe('ERR_NFC');
  });

  it('handles an unwrapped error unchanged', () => {
    expect(describeNativeError(new Error('plain failure'))).toMatchObject({
      message: 'plain failure',
      chain: ['plain failure'],
    });
  });

  it('handles several nested causes', () => {
    const nested = new Error('A → Caused by: B: middle → Caused by: CException: innermost');

    expect(describeNativeError(nested)).toMatchObject({
      code: 'CException',
      message: 'innermost',
    });
  });

  it('survives a thrown non-Error', () => {
    expect(describeNativeError('just a string').message).toBe('just a string');
  });

  /**
   * The separator is Expo's implementation detail. If it changes, we must
   * degrade to showing everything rather than mangling the text.
   */
  it('degrades to the full message if the separator ever changes', () => {
    const future = new Error('Calling failed ;; because: SomethingException: detail');

    expect(describeNativeError(future).message).toContain('detail');
  });
});

describe('expoCodeFor — mirroring Expo’s own derivation', () => {
  /**
   * Expo does NOT use the class name as the code. It strips the trailing
   * `Exception`, splits camelCase and upper-cases, per
   * `expo-modules-core/ios/Core/Exceptions/CodedError.swift:45`.
   *
   * Assuming the code *was* the class name is what made a cancelled scan
   * render a "Could not read the tag" error after T9 — the mapping table was
   * keyed one way and matched the other.
   */
  it.each([
    ['UserCancelledException', 'ERR_USER_CANCELLED'],
    ['TimeoutException', 'ERR_TIMEOUT'],
    ['NfcUnavailableException', 'ERR_NFC_UNAVAILABLE'],
    ['TagTooSmallException', 'ERR_TAG_TOO_SMALL'],
    ['TagReadOnlyException', 'ERR_TAG_READ_ONLY'],
    ['NoNfcSettingsException', 'ERR_NO_NFC_SETTINGS'],
    ['WriteFailedException', 'ERR_WRITE_FAILED'],
  ])('%s → %s', (className, code) => {
    expect(expoCodeFor(className)).toBe(code);
  });

  it('strips a trailing Error as well as Exception', () => {
    expect(expoCodeFor('SomeBadError')).toBe('ERR_SOME_BAD');
  });

  it('strips generic parameters', () => {
    expect(expoCodeFor('GenericException<String>')).toBe('ERR_GENERIC');
  });
});

describe('className is recovered separately from code', () => {
  it('keeps the Swift class name from the cause chain', () => {
    expect(describeNativeError(WRAPPED).className).toBe('NoNfcSettingsException');
  });

  it('is null when there is no class name to find', () => {
    expect(describeNativeError(new Error('plain')).className).toBeNull();
  });

  /** The real shape: Expo sets `code`, the chain carries the class name. */
  it('reports both when they disagree, which is the normal case', () => {
    const real = Object.assign(
      new Error(
        "Calling the 'readTag' function has failed → Caused by: UserCancelledException: The scan was cancelled."
      ),
      { code: 'ERR_USER_CANCELLED' }
    );

    const info = describeNativeError(real);
    expect(info.code).toBe('ERR_USER_CANCELLED');
    expect(info.className).toBe('UserCancelledException');
  });
});
