/**
 * Our module, presented the way `lib/nfc.ts` presents the library.
 *
 * Same shapes in and out, so T9 can swap one for the other behind a flag and
 * every screen, every decoder and every test carries on unchanged. Matching an
 * existing interface is the cheapest way to make a replacement provable rather
 * than merely plausible.
 */

import type { NdefRecord } from 'react-native-nfc-manager';

import NfcNative from '../modules/nfc-native/src/NfcNativeModule';
import type { NativeTagResult } from '../modules/nfc-native/src/NfcNative.types';
import { describeNativeError } from './nativeError';
import type { RawTag } from './tagFacts';

export type NativeReadResult = {
  tag: RawTag;
  /** Straight from the tag — no assumption involved. */
  capacity: number | null;
  status: NativeTagResult['status'];
};

/**
 * Read one tag through our own Swift.
 *
 * The returned tag is shaped like the library's `TagEvent` on purpose, so the
 * store, the decoder and Tag Info cannot tell which implementation produced it.
 */
export async function readTagNative(
  alertMessage = 'Hold your iPhone near the NFC tag.'
): Promise<NativeReadResult> {
  const result = await NfcNative.readTag(alertMessage);

  return {
    tag: {
      id: result.id,
      tech: result.tech,
      // Our Swift returns a real capacity, so unlike the library's read path
      // this can populate `maxSize` — the field Tag Info has been rendering as
      // "Not reported" since Phase 2.
      maxSize: result.capacity > 0 ? result.capacity : undefined,
      isWritable: result.status === 2,
      ndefMessage: result.ndefMessage as unknown as NdefRecord[],
    },
    capacity: result.capacity > 0 ? result.capacity : null,
    status: result.status,
  };
}

/**
 * Did the user back out?
 *
 * Matching on the unwrapped code rather than the message. `lib/nativeError.ts`
 * digs it out from under Expo's `FunctionCallException` wrapper — see §T1a.
 */
export function isNativeCancellation(error: unknown): boolean {
  return describeNativeError(error).code === 'UserCancelledException';
}
