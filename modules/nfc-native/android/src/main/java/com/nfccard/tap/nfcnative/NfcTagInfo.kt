package com.nfccard.tap.nfcnative

import android.nfc.NdefMessage
import android.nfc.Tag
import android.nfc.tech.Ndef

/**
 * Turning an Android `Tag` into things that can cross the bridge.
 *
 * The counterpart to `NfcTagInfo.swift`, and deliberately producing the **same
 * shapes**: `lib/ndef.ts` decodes both platforms' output with one code path, so
 * a disagreement here would surface as a decoding bug rather than as a platform
 * difference.
 *
 * ⛔ Compiled but never run. No Android device has been available since Phase 1.
 */
internal object NfcTagInfo {
  /** Uppercase hex, no separators — matching iOS and what the app displays. */
  fun identifier(tag: Tag): String = tag.id.joinToString("") { "%02X".format(it) }

  /**
   * Android lists every technology a tag supports; iOS reports one family name.
   *
   * The app takes the first as `tech` and keeps the full list in `techTypes`,
   * which is the shape `lib/tagFacts.ts` already renders — it has been showing
   * "iOS reports one family name; Android lists every supported technology"
   * since Phase 2, on the strength of documentation rather than observation.
   */
  fun techTypes(tag: Tag): List<String> = tag.techList.toList()

  /** Records as plain maps of primitives. `ByteArray` does not cross. */
  fun records(message: NdefMessage?): List<Map<String, Any>> {
    val records = message?.records ?: return emptyList()

    return records.map { record ->
      mapOf(
        "tnf" to record.tnf.toInt(),
        "type" to record.type.map { it.toInt() and 0xFF },
        "id" to record.id.map { it.toInt() and 0xFF },
        "payload" to record.payload.map { it.toInt() and 0xFF },
      )
    }
  }

  /**
   * Android's equivalent of iOS's `NFCNDEFStatus`, derived rather than reported.
   *
   * iOS answers this directly (`queryNDEFStatus` → notSupported / readWrite /
   * readOnly). Android exposes `isWritable` on a connected `Ndef`, and "not
   * supported" is signalled by `Ndef.get()` returning null rather than by any
   * status value. Mapping both onto one set of numbers keeps the TypeScript
   * from needing to know which platform it is talking to.
   */
  fun status(ndef: Ndef?): Int =
    when {
      ndef == null -> 1 // not NDEF
      ndef.isWritable -> 2 // read-write
      else -> 3 // read-only
    }
}
