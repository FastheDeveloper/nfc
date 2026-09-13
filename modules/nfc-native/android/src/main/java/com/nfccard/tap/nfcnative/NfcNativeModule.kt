package com.nfccard.tap.nfcnative

import android.content.Context
import android.content.Intent
import android.nfc.NfcAdapter
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * TapCard's own NFC bridge — Android side.
 *
 * The mirror of the Swift module, and the differences are the interesting
 * part. Android has a real NFC adapter object, a real enabled/disabled state
 * the user controls, and a settings screen to deep-link into. iOS has none of
 * those, which is why `isEnabled` and `openNfcSettings` mean genuinely
 * different things here.
 *
 * ⛔ Compiled but never run: no Android device has been available since the
 * identifier rename in Phase 1. Nothing in this file is claimed as observed.
 */
class NfcNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw MissingContextException()

  /** Null on a device with no NFC hardware at all. */
  private fun adapter(): NfcAdapter? = NfcAdapter.getDefaultAdapter(context)

  /**
   * Held for the life of the module so the app can cancel it.
   *
   * The iOS side retains its session for a different reason — ARC would collect
   * it mid-scan. Here the reason is that reader mode has no session object at
   * all, so *something* has to remember what to switch off.
   */
  private var session: NfcReaderSession? = null

  /**
   * Reader mode attaches to the foreground Activity, not a Context.
   *
   * There is no iOS equivalent of this failure: CoreNFC does not care what is
   * on screen. Here, a scan started while the app is backgrounded has nothing
   * to attach to.
   */
  private fun requireActivity() =
    appContext.activityProvider?.currentActivity ?: throw NoActivityException()

  override fun definition() = ModuleDefinition {
    Name("NfcNative")

    Function("isSupported") {
      adapter() != null
    }

    /**
     * A real question on Android, unlike iOS.
     *
     * NFC is a system toggle in Settings, so "supported" and "enabled" are two
     * different facts and an app must handle the gap between them — the user
     * can switch NFC off while the app is open.
     */
    Function("isEnabled") {
      adapter()?.isEnabled == true
    }

    Function("canOpenSettings") {
      adapter() != null
    }

    /**
     * Deep-link into the NFC settings screen.
     *
     * `FLAG_ACTIVITY_NEW_TASK` is required because we are starting an activity
     * from a context that is not itself an activity. Without it this throws at
     * runtime — and it is exactly the kind of detail a JavaScript-only
     * developer never has to know, which is half the point of this phase.
     */
    /**
     * Read one tag.
     *
     * `alertMessage` is accepted and **ignored** — it exists because iOS shows
     * a system sheet and this signature is shared. Android draws no scanning UI
     * whatsoever, which is why the app has always had to render its own
     * (PLATFORM-NOTES §3).
     */
    AsyncFunction("readTag") { _: String, promise: Promise ->
      val adapter = adapter() ?: throw NfcUnavailableException()
      if (!adapter.isEnabled) throw NfcDisabledException()

      NfcReaderSession(adapter, requireActivity()).also { session = it }.read(promise)
    }

    AsyncFunction("writeTag") { _: String, bytes: List<Int>, promise: Promise ->
      val adapter = adapter() ?: throw NfcUnavailableException()
      if (!adapter.isEnabled) throw NfcDisabledException()

      val payload = ByteArray(bytes.size) { i -> (bytes[i] and 0xFF).toByte() }

      NfcReaderSession(adapter, requireActivity()).also { session = it }.write(payload, promise)
    }

    /**
     * Stop an in-flight scan.
     *
     * **No iOS counterpart.** There, the system sheet owns cancelling. Here the
     * app must draw its own button and call this, or reader mode simply stays
     * on until the activity goes away.
     */
    AsyncFunction("cancelScan") {
      session?.cancel()
      session = null
    }

    AsyncFunction("openNfcSettings") {
      if (adapter() == null) throw NoNfcHardwareException()

      val intent = Intent(Settings.ACTION_NFC_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }
}

internal class MissingContextException :
  CodedException("The Android context has gone away — the activity was probably destroyed.")

internal class NoNfcHardwareException :
  CodedException("This device has no NFC hardware, so there is no NFC setting to open.")

internal class NoActivityException :
  CodedException("NFC scanning needs the app to be in the foreground.")

internal class NfcUnavailableException :
  CodedException("This device cannot read NFC tags.")

/**
 * Android only, and unreachable on iOS by construction — there is no NFC toggle
 * to switch off. The asymmetry PLATFORM-NOTES §7 describes, as an error type.
 */
internal class NfcDisabledException :
  CodedException("NFC is switched off. Turn it on in system settings, then scan again.")

internal class NotNdefException :
  CodedException("This tag does not hold NDEF data. It may need formatting first.")

internal class UserCancelledException : CodedException("The scan was cancelled.")

internal class InvalidMessageException :
  CodedException("Those bytes are not a valid NDEF message, so nothing was sent to the tag.")

internal class TagReadOnlyException(capacity: Int) :
  CodedException("This tag is locked read-only and cannot be changed. It holds $capacity bytes.")

internal class TagTooSmallException(detail: String) :
  CodedException("Too big for this tag: $detail. Nothing was written.")

internal class WriteFailedException(detail: String) :
  CodedException("The write did not complete: $detail. The tag may be partly written.")

internal class SessionFailedException(detail: String) :
  CodedException("The NFC session failed: $detail.")
