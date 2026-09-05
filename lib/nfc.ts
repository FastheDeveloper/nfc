import * as Device from 'expo-device';
import { Platform } from 'react-native';
import NfcManager, { NfcTech, type TagEvent } from 'react-native-nfc-manager';

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
