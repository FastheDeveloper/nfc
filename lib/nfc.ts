import * as Device from 'expo-device';
import { Platform } from 'react-native';
import NfcManager, { NfcTech, type TagEvent } from 'react-native-nfc-manager';
import * as NfcError from 'react-native-nfc-manager/src/NfcError';

import { encodeMessage } from './ndefEncode';
import { WritePreflightError } from './writeError';

/**
 * Phase 1 NFC plumbing.
 *
 * Everything here is deliberately thin — the goal is to get a raw NDEF dump on
 * both platforms and expose the places where the two behave differently, rather
 * than to hide them behind a tidy abstraction. Phase 2 builds the real parsing
 * and error UX on top.
 */

export type NfcStatus =
  | { kind: 'checking' }
  /** Hardware present and the adapter is usable. */
  | { kind: 'ready' }
  /**
   * Android only: the device has NFC but the user has switched it off.
   * iOS never reports this — see `checkNfcStatus` for why.
   */
  | { kind: 'disabled' }
  | { kind: 'unsupported'; reason: string };

let startOnce: Promise<boolean> | null = null;

/**
 * `NfcManager.start()` must run exactly once per app launch, before any other
 * call. We memoise the promise rather than a boolean so that concurrent callers
 * during the first render all await the same attempt.
 */
export function startNfc(): Promise<boolean> {
  startOnce ??= (async () => {
    // NFC hardware does not exist on the iOS Simulator or the Android emulator,
    // and `isSupported()` is not reliable there. Bail out early and explicitly.
    if (!Device.isDevice) return false;
    if (!(await NfcManager.isSupported())) return false;
    await NfcManager.start();
    return true;
  })().catch(() => false);

  return startOnce;
}

export async function checkNfcStatus(): Promise<NfcStatus> {
  if (!Device.isDevice) {
    return {
      kind: 'unsupported',
      reason: `NFC is not available on the ${Platform.OS === 'ios' ? 'iOS Simulator' : 'Android emulator'}. Use a physical device.`,
    };
  }

  const started = await startNfc();
  if (!started) {
    return { kind: 'unsupported', reason: 'This device has no NFC hardware.' };
  }

  // Platform asymmetry #1, and the reason Phase 4 exists.
  //
  // On Android this is a real native call to `NfcAdapter.isEnabled()` — NFC is a
  // system toggle the user can turn off, so "supported" and "enabled" are two
  // different questions.
  //
  // On iOS the library hardcodes `return true` (see
  // node_modules/react-native-nfc-manager/src/NfcManagerIOS.js), because iOS
  // exposes no user-facing NFC toggle at all. So on iOS this branch is
  // unreachable by construction, not merely unlikely.
  if (!(await NfcManager.isEnabled())) {
    return { kind: 'disabled' };
  }

  return { kind: 'ready' };
}

/**
 * One scan, one tag, raw.
 *
 * Both platforms accept the same two calls, but what the user sees could not be
 * more different:
 *
 *   iOS     `requestTechnology` hands control to CoreNFC, which draws a system
 *           modal sheet showing `alertMessage`. The user can cancel it, and our
 *           JS gets an error. We never draw scanning UI ourselves.
 *   Android  Nothing is drawn. Foreground dispatch is silent, so the *app* is
 *           responsible for telling the user to tap a tag, and `alertMessage`
 *           is ignored entirely.
 */
export async function readTagOnce(): Promise<TagEvent | null> {
  await NfcManager.requestTechnology(NfcTech.Ndef, {
    alertMessage: 'Hold your iPhone near the NFC tag.',
  });

  try {
    return await NfcManager.getTag();
  } finally {
    // `throwOnError: false` because we are already unwinding — a failure to
    // close the session must not mask the original error.
    await NfcManager.cancelTechnologyRequest({ throwOnError: false });
  }
}

/** Best-effort abort, used when the user backs out on Android. */
export async function cancelScan(): Promise<void> {
  await NfcManager.cancelTechnologyRequest({ throwOnError: false });
}

/** NDEF payloads arrive as byte arrays; show them as hex for the raw dump. */
export function toHex(bytes: readonly number[] | undefined): string {
  if (!bytes?.length) return '(empty)';
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

/** NDEF record `type` is bytes on Android and sometimes a string on iOS. */
export function describeRecordType(type: number[] | string | undefined): string {
  if (type == null) return '(none)';
  if (typeof type === 'string') return type;
  const ascii = type.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
  return `${ascii}  [${toHex(type)}]`;
}

// ---------------------------------------------------------------------------
// Phase 3 — writing
// ---------------------------------------------------------------------------

/** `NFCNDEFStatus` on iOS; derived from `isWritable` on Android. */
export const NdefStatus = {
  NotSupported: 1,
  ReadWrite: 2,
  ReadOnly: 3,
} as const;

export type NdefStatusValue = (typeof NdefStatus)[keyof typeof NdefStatus];

/** What a write session learned and did. */
export type WriteOutcome = {
  status: NdefStatusValue;
  /**
   * The tag's real NDEF capacity in bytes, or null if the platform did not
   * say. On iOS this comes from CoreNFC's `queryNDEFStatus` — **not** from
   * `getTag()`, which reports no size at all (DEVLOG §1.12).
   */
  capacity: number | null;
  /** Bytes handed to the tag. */
  written: number;
  /** Did a read-back inside the same session return what we wrote? */
  verified: boolean;
  /** Why verification failed, when it did. */
  verifyNote: string | null;
};

/**
 * Ask the tag what it is before writing to it.
 *
 * Must be called inside an open technology session. Returns null rather than
 * throwing when the platform cannot answer — a missing status is a reason to
 * fall back to an assumed budget, not a reason to abandon the write.
 */
async function queryStatus(): Promise<{ status: NdefStatusValue; capacity: number | null } | null> {
  try {
    const result = await NfcManager.ndefHandler.getNdefStatus();

    return {
      status: (result?.status ?? NdefStatus.NotSupported) as NdefStatusValue,
      capacity:
        typeof result?.capacity === 'number' && result.capacity > 0 ? result.capacity : null,
    };
  } catch {
    return null;
  }
}

/**
 * Write an NDEF message to a tag, then check it took.
 *
 * The whole thing happens inside **one** technology session, which matters on
 * iOS: each `requestTechnology` puts a system sheet in front of the user, so
 * querying, writing and verifying in separate sessions would mean three
 * sheets and three taps for one logical action.
 *
 * The order is deliberate:
 *
 *   1. Query status — is this tag even writable, and how big is it really?
 *   2. Refuse early if it is read-only or genuinely too small. A refusal
 *      before the write is a tag left untouched; a failure during one may
 *      leave it half-written.
 *   3. Write.
 *   4. Read it back and compare. A write that reports success and did not
 *      happen is the worst outcome available, so success is *verified*
 *      rather than assumed.
 *
 * Writing replaces the tag's contents. It does **not** lock the tag — nothing
 * in this project calls `makeReadOnly`, which is irreversible.
 */
export async function writeNdef(bytes: number[]): Promise<WriteOutcome> {
  await NfcManager.requestTechnology(NfcTech.Ndef, {
    alertMessage: 'Hold your iPhone near the tag to write it.',
  });

  try {
    const queried = await queryStatus();
    const reported = queried ?? {
      status: NdefStatus.NotSupported as NdefStatusValue,
      capacity: null,
    };

    // Refuse with *our* error type, carrying what the tag actually said, so a
    // refusal here is never confused with one from CoreNFC during the write.
    if (queried?.status === NdefStatus.ReadOnly) {
      throw new WritePreflightError('read-only', reported, bytes.length);
    }

    if (queried?.capacity != null && bytes.length > queried.capacity) {
      throw new WritePreflightError('too-big', reported, bytes.length);
    }

    await NfcManager.ndefHandler.writeNdefMessage(bytes);

    const { verified, verifyNote } = await verifyWrite(bytes);

    return {
      status: queried?.status ?? NdefStatus.ReadWrite,
      capacity: queried?.capacity ?? null,
      written: bytes.length,
      verified,
      verifyNote,
    };
  } finally {
    await NfcManager.cancelTechnologyRequest({ throwOnError: false });
  }
}

/**
 * Read the tag back inside the same session and compare.
 *
 * Compares the re-encoded message rather than the raw bytes, because the
 * records come back parsed and re-serialising them is the only way to get a
 * comparable byte string. A mismatch is reported, never thrown: the write
 * itself succeeded, and telling the user "it worked but I could not confirm
 * it" is more honest than either silence or a failure.
 */
async function verifyWrite(
  expected: number[]
): Promise<{ verified: boolean; verifyNote: string | null }> {
  try {
    // Despite the name and its `TagEvent` type, this resolves to an object
    // whose only key is `ndefMessage` — the records live one level down.
    const readBack = await NfcManager.ndefHandler.getNdefMessage();
    const records = readBack?.ndefMessage;

    if (!records?.length) {
      return { verified: false, verifyNote: 'The tag read back empty.' };
    }

    const actual = encodeMessage(records);

    if (actual.length !== expected.length) {
      return {
        verified: false,
        verifyNote: `Read back ${actual.length} bytes, expected ${expected.length}.`,
      };
    }

    const same = actual.every((byte, i) => byte === expected[i]);

    return same
      ? { verified: true, verifyNote: null }
      : { verified: false, verifyNote: 'The tag read back different bytes.' };
  } catch {
    return { verified: false, verifyNote: 'Could not read the tag back to check.' };
  }
}
