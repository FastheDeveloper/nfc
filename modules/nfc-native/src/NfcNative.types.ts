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
  /** `mifare` | `iso7816` | `iso15693` | `felica` on iOS; the first tech on Android. */
  tech: string;
  /**
   * Every technology the tag supports. **Android only.**
   *
   * iOS reports a single family name and has no equivalent — the difference
   * PLATFORM-NOTES §5 recorded from documentation in Phase 2 and can now be
   * observed.
   */
  techTypes?: string[];
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

/** What a write session learned and did. */
export type NativeWriteResult = {
  id: string;
  tech: string;
  status: NativeNdefStatus;
  /** The tag's own capacity, reported before anything was written. */
  capacity: number;
  /** Bytes handed to the tag. */
  written: number;
  /**
   * Did a read-back inside the same session return the same records?
   *
   * Compared by record content, not raw bytes: a tag may legally return a
   * message whose framing differs from what we sent while carrying identical
   * data. What matters is that the content survived.
   */
  verified: boolean;
  /** What the tag actually held afterwards. */
  readBack: NativeNdefRecord[];
};

/** The result of a lock attempt. Irreversible either way. */
export type NativeLockResult = {
  id: string;
  tech: string;
  /** NDEF status read back *after* the attempt. 3 means it took. */
  statusAfter: NativeNdefStatus;
  capacity: number;
  /**
   * Whether the tag confirmed read-only afterwards.
   *
   * Unlike a write, a false here is not a soft warning — if the status did not
   * come back read-only, the chip's state is unknown, and you cannot retry to
   * find out because retrying is the destructive act.
   */
  verified: boolean;
};
