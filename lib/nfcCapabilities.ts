/**
 * What our own module says about NFC on this device.
 *
 * The raw bridge returns booleans. This layer turns them into something a UI
 * can be honest with, because the *same* boolean means different things on the
 * two platforms:
 *
 *   Android  isEnabled() is a real runtime state the user controls in Settings
 *            and can change while the app is open.
 *   iOS      there is no NFC toggle at all, so the question does not exist and
 *            the only truthful answer is "if the hardware works, it is on".
 *
 * A cross-platform API that returns a bare boolean here is lying by omission.
 * This one reports *why* it said what it said.
 */

import { Platform } from 'react-native';

import NfcNative from '../modules/nfc-native/src/NfcNativeModule';

export type NfcCapabilities = {
  supported: boolean;
  enabled: boolean;
  /** Whether "enabled" is a real, changeable state on this platform. */
  enabledIsMeaningful: boolean;
  canOpenSettings: boolean;
};

export function readCapabilities(): NfcCapabilities {
  return {
    supported: NfcNative.isSupported(),
    enabled: NfcNative.isEnabled(),
    // The whole asymmetry, in one field.
    enabledIsMeaningful: Platform.OS === 'android',
    canOpenSettings: NfcNative.canOpenSettings(),
  };
}

/** Android only. On iOS this rejects with a typed error carrying a real message. */
export async function openNfcSettings(): Promise<void> {
  await NfcNative.openNfcSettings();
}
