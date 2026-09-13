/**
 * What the native side sends across the bridge.
 *
 * Everything is a primitive or an array of them. `Data`, `NSData` and Kotlin's
 * `ByteArray` do not cross — they become `number[]`, which is exactly the shape
 * `lib/ndef.ts` already decodes.
 *
 * That is the deliberate boundary of this phase: we are replacing the **native
 * bridge**, not the parser. The TypeScript decoder, its 60 tests and its three
 * fixes for defects in the library's own decoder all keep working untouched.
 */

/** Mirrors `NFCNDEFStatus` on iOS; derived from `isWritable` on Android. */
export type NativeNdefStatus = 1 | 2 | 3;

export type NativeNdefRecord = {
  /** Type Name Format — the 3-bit field `lib/ndef.ts` dispatches on. */
  tnf: number;
  type: number[];
  id: number[];
  payload: number[];
};

export type NativeTagResult = {
  /** Uppercase hex, no separators. */
  id: string;
  /** `mifare` | `iso7816` | `iso15693` | `felica` on iOS; a tech list on Android. */
  tech: string;
  /** 1 not-supported · 2 read-write · 3 read-only. */
  status: NativeNdefStatus;
  /**
   * Maximum NDEF **message** size in bytes, straight from the tag.
   *
   * The number Phases 1–2 wrongly concluded was unobtainable on iOS
   * (DEVLOG §3.1). A real NTAG213 reports 137.
   */
  capacity: number;
  ndefMessage: NativeNdefRecord[];
};

export type NfcNativeModuleEvents = Record<never, never>;
