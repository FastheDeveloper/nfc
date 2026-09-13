package com.nfccard.tap.nfcnative

import android.content.Context
import android.content.Intent
import android.nfc.NfcAdapter
import android.provider.Settings
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
