import { describe, expect, it } from '@jest/globals';

import { describeNativeError } from './nativeError';

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
