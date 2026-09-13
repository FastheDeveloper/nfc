/**
 * The shapes that cross the native bridge.
 *
 * These were imported from `react-native-nfc-manager` until Phase 4 T10. We
 * own them now, and two corrections came with that:
 *
 *   - `ndefMessage` is **optional**. The library declared it required, but a
 *     blank NDEF-formatted tag on iOS came back with no such key at all
 *     (DEVLOG §1.12). The library's own type was wrong about its own data.
 *   - `payload` is `number[]`, not `any[]`.
 *
 * Our module produces exactly this shape, so the decoder, the store and every
 * screen carried on unchanged through the swap.
 */

export type NdefRecord = {
  id?: number[];
  /** Type Name Format — the 3-bit field `lib/ndef.ts` dispatches on. */
  tnf: number;
  /** Bytes on Android, sometimes an already-decoded string on iOS. */
  type: number[] | string;
  payload: number[];
};

export type TagEvent = {
  /** Absent, not empty, on a blank tag read through iOS. */
  ndefMessage?: NdefRecord[];
  /** Maximum NDEF **message** size. Present whenever the tag was asked. */
  maxSize?: number;
  type?: string;
  techTypes?: string[];
  id?: string;
};
