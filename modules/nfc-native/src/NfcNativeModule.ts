import { NativeModule, requireNativeModule } from 'expo';

import type { NativeTagResult, NativeWriteResult } from './NfcNative.types';

/**
 * The raw bridge surface.
 *
 * Kept deliberately thin and unfriendly — it mirrors the native side exactly,
 * with no interpretation. `lib/nfcCapabilities.ts` is where the platform
 * differences get explained; conflating the two is how a "cross-platform" API
 * ends up quietly lying about one of its platforms.
 */
declare class NfcNativeModule extends NativeModule<Record<never, never>> {
  /** Does the device have usable NFC hardware? False on every simulator. */
  isSupported(): boolean;

  /**
   * Android: the real `NfcAdapter.isEnabled()` — a user-controllable toggle.
   * iOS: the same answer as `isSupported()`, because no such toggle exists.
   */
  isEnabled(): boolean;

  /** Whether `openNfcSettings()` will do anything. Always false on iOS. */
  canOpenSettings(): boolean;

  /** Android: deep-links to NFC settings. iOS: throws `NoNfcSettingsException`. */
  openNfcSettings(): Promise<void>;

  /**
   * Read one tag, then end the session.
   *
   * `alertMessage` is shown in the iOS system sheet and ignored on Android,
   * which draws no scanning UI at all — the same asymmetry the app has been
   * working around since Phase 1, now visible in our own signature.
   *
   * Rejects with a typed exception: `UserCancelledException`,
   * `TimeoutException`, `NotNdefException`, and others in `NfcExceptions.swift`.
   */
  readTag(alertMessage: string): Promise<NativeTagResult>;

  /**
   * Write an NDEF message, then verify it inside the same session.
   *
   * One session, not two: on iOS each one puts a system sheet in front of the
   * user, so writing and verifying separately would mean two sheets and two
   * taps for one action.
   *
   * Rejects with `TagReadOnlyException`, `TagTooSmallException` (our own
   * refusal, carrying the tag's numbers — never CoreNFC's error),
   * `InvalidMessageException`, or `WriteFailedException`.
   */
  writeTag(alertMessage: string, bytes: number[]): Promise<NativeWriteResult>;

  /**
   * Stop an in-flight scan.
   *
   * **Android only.** iOS does not implement it, because the system sheet owns
   * cancelling there — call it and the bridge will not find the function. See
   * `lib/nfcBackend.ts`, which guards on platform.
   */
  cancelScan(): Promise<void>;
}

export default requireNativeModule<NfcNativeModule>('NfcNative');
