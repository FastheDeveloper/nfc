/**
 * The one place the app chooses an NFC implementation.
 *
 * Every screen imports from here, and nothing else in the app talks to the
 * native layer. That indirection is what made the swap in T9 a one-line change
 * rather than a rewrite.
 *
 * **`react-native-nfc-manager` was removed in T10.** The switch it used to hold
 * is gone with it: there is one implementation now, ours. The module stays
 * because the boundary is worth keeping — it is where a second implementation
 * would go if one were ever needed again, and it is the only file that has to
 * know how the native side is shaped.
 *
 * Switching was justified by measurement, not preference. The parity harness
 * read the same physical tag through both implementations and found **four
 * fields identical and two reported only by ours** (capacity and writability),
 * with nothing in conflict.
 */

import * as Device from 'expo-device';

import { readCapabilities } from './nfcCapabilities';
import {
  cancelScanNative,
  lockTagNative,
  readTagNative,
  writeTagNative,
  type NativeLockOutcome,
} from './nfcNative';
import type { RawTag } from './tagFacts';

/**
 * The NFC capability of this device, as the app cares about it.
 *
 * `disabled` is Android-only and unreachable on iOS by construction — there is
 * no NFC toggle to switch off (PLATFORM-NOTES §7).
 */
export type NfcStatus =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'disabled' }
  | { kind: 'unsupported'; reason: string };

/** What a write session learned and did. */
export type WriteOutcome = {
  status: 1 | 2 | 3;
  capacity: number | null;
  written: number;
  verified: boolean;
  verifyNote: string | null;
};

export type ReadResult = {
  tag: RawTag | null;
  /**
   * The tag's real capacity, when the backend could get it.
   *
   * Always null on the library backend: its read path does not carry a size
   * (DEVLOG §3.1). Our module asks the NDEF status query on every read, so this
   * is populated — the single most visible improvement from the swap.
   */
  capacity: number | null;
};

/**
 * One-time init.
 *
 * The library requires `NfcManager.start()` before any other call. Ours needs
 * nothing — each session is self-contained — so this is a no-op on the native
 * backend rather than a shim pretending otherwise.
 */
export async function startNfc(): Promise<boolean> {
  return Device.isDevice;
}

export async function checkNfcStatus(): Promise<NfcStatus> {
  if (!Device.isDevice) {
    return {
      kind: 'unsupported',
      reason: 'NFC is not available on a simulator. Use a physical device.',
    };
  }

  const capabilities = readCapabilities();

  if (!capabilities.supported) {
    return { kind: 'unsupported', reason: 'This device has no NFC hardware.' };
  }

  // `enabledIsMeaningful` is false on iOS, where there is no NFC toggle, so
  // "disabled" is unreachable there by construction rather than merely
  // unlikely — the asymmetry PLATFORM-NOTES §7 describes.
  if (capabilities.enabledIsMeaningful && !capabilities.enabled) {
    return { kind: 'disabled' };
  }

  return { kind: 'ready' };
}

export async function readTag(): Promise<ReadResult> {
  const result = await readTagNative();
  return { tag: result.tag, capacity: result.capacity };
}

export async function writeTag(bytes: number[]): Promise<WriteOutcome> {
  const result = await writeTagNative(bytes);

  return {
    status: result.status,
    capacity: result.capacity,
    written: result.written,
    verified: result.verified,
    verifyNote: result.verifyNote,
  };
}

/**
 * Abort an in-flight scan.
 *
 * Android only, by necessity rather than omission. iOS cancels through the
 * system sheet, which our session already handles, so the Swift module has no
 * such function — `cancelScanNative` guards on platform. Android draws no
 * system UI at all, so reader mode stays on until the app switches it off.
 */
export async function cancelScan(): Promise<void> {
  await cancelScanNative();
}

/**
 * Make a tag permanently read-only.
 *
 * Deliberately the last function in this file, and deliberately the only one
 * whose doc comment says this: **it cannot be undone.** The chip's lock bits
 * are burned. No app on any phone can write to it again.
 */
export async function lockTag(): Promise<NativeLockOutcome> {
  return lockTagNative();
}
