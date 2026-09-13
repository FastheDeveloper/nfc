package com.nfccard.tap.nfcnative

import android.app.Activity
import android.nfc.NdefMessage
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.os.Bundle
import expo.modules.kotlin.Promise
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One Android NFC operation, read or write.
 *
 * This is where the platforms stop resembling each other. iOS gives you a
 * *session*: you begin it, the OS draws a sheet, it hands you a tag, you
 * invalidate it. Android gives you **reader mode** — a callback attached to an
 * Activity that fires every time a tag comes near, with no UI, no session
 * object, and no natural end.
 *
 * The consequences, all of which are ours to handle rather than the platform's:
 *
 *  - **It needs an Activity**, not a Context. Reader mode is bound to the
 *    foreground activity, so there is nothing to attach to if the app is not
 *    actually in front of the user.
 *  - **It never stops on its own.** iOS invalidates after one tag; here we must
 *    call `disableReaderMode` ourselves, on every exit path.
 *  - **The callback is not on the main thread.** It arrives on a binder thread,
 *    which is fine for resolving a promise and would not be for touching UI.
 *  - **Cancelling is entirely our problem.** On iOS the system sheet offers it.
 *    Here the app must draw its own way out and call `cancel()` — which is why
 *    `lib/nfcBackend.ts` has a real implementation on Android and a documented
 *    no-op on iOS.
 *
 * ⛔ Compiled but never run. Nothing in this file is claimed as observed.
 */
internal class NfcReaderSession(
  private val adapter: NfcAdapter,
  private val activity: Activity,
) {
  /** Guards the promise. Same discipline as the Swift: settle exactly once. */
  private val settled = AtomicBoolean(false)
  private var promise: Promise? = null

  /** Non-null for a write; null for a read. */
  private var messageToWrite: NdefMessage? = null

  /** True for a lock. Irreversible, so it is its own flag rather than a mode. */
  private var lockRequested = false

  private val flags =
    NfcAdapter.FLAG_READER_NFC_A or
      NfcAdapter.FLAG_READER_NFC_B or
      NfcAdapter.FLAG_READER_NFC_F or
      NfcAdapter.FLAG_READER_NFC_V or
      // Without this the platform plays its own discovery sound and shows its
      // own animation over ours — the OS competing with an app that is already
      // telling the user what to do.
      NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS

  fun read(promise: Promise) = start(promise, null)

  /**
   * Make the tag permanently read-only. ⛔ Never run on a device.
   *
   * Same order as the Swift: ask first, refuse an already-locked tag distinctly
   * from a failure, then verify by re-reading rather than trusting the call.
   */
  fun lock(promise: Promise) {
    lockRequested = true
    start(promise, null)
  }

  fun write(bytes: ByteArray, promise: Promise) {
    val message =
      try {
        // Parsed before a tag is involved, exactly as the Swift does — a
        // malformed message fails early and harmlessly.
        NdefMessage(bytes)
      } catch (e: Exception) {
        promise.reject(InvalidMessageException())
        return
      }

    start(promise, message)
  }

  private fun start(promise: Promise, message: NdefMessage?) {
    this.promise = promise
    this.messageToWrite = message

    adapter.enableReaderMode(activity, ::onTagDiscovered, flags, Bundle())
  }

  /** The app's own Cancel button. iOS has no equivalent call. */
  fun cancel() {
    stopReaderMode()
    rejectOnce(UserCancelledException())
  }

  private fun onTagDiscovered(tag: Tag) {
    val ndef = Ndef.get(tag)

    if (ndef == null) {
      stopReaderMode()
      rejectOnce(NotNdefException())
      return
    }

    try {
      ndef.connect()

      val status = NfcTagInfo.status(ndef)
      val capacity = ndef.maxSize

      if (lockRequested) {
        if (!ndef.isWritable) {
          // Already read-only: the tag is in exactly the state requested, which
          // is not a failure and must not be reported as one.
          stopReaderMode()
          rejectOnce(AlreadyLockedException())
          return
        }

        ndef.makeReadOnly()

        // Verify by asking again rather than trusting the call, for the same
        // reason as the Swift: you cannot retry to find out, because retrying
        // is itself the destructive act.
        val lockedNow = !ndef.isWritable

        stopReaderMode()
        resolveOnce(
          mapOf(
            "id" to NfcTagInfo.identifier(tag),
            "tech" to (NfcTagInfo.techTypes(tag).firstOrNull() ?: "unknown"),
            "statusAfter" to if (lockedNow) 3 else 2,
            "capacity" to capacity,
            "verified" to lockedNow,
          )
        )
        return
      }

      messageToWrite?.let { message ->
        // Ask before acting, same order as the Swift: refusing leaves the tag
        // untouched, failing partway through a write may not.
        if (!ndef.isWritable) {
          stopReaderMode()
          rejectOnce(TagReadOnlyException(capacity))
          return
        }

        if (message.toByteArray().size > capacity) {
          stopReaderMode()
          rejectOnce(
            TagTooSmallException(
              "the tag reports $capacity bytes and this needs ${message.toByteArray().size}"
            )
          )
          return
        }

        ndef.writeNdefMessage(message)
      }

      // Read back in the same connection — for a write this is verification,
      // for a read it is simply the result.
      val onTag = ndef.ndefMessage
      val readRecords = NfcTagInfo.records(onTag)

      val result =
        mutableMapOf<String, Any?>(
          "id" to NfcTagInfo.identifier(tag),
          "tech" to (NfcTagInfo.techTypes(tag).firstOrNull() ?: "unknown"),
          "techTypes" to NfcTagInfo.techTypes(tag),
          "status" to status,
          "capacity" to capacity,
          "ndefMessage" to readRecords,
        )

      messageToWrite?.let { sent ->
        result["written"] = sent.toByteArray().size
        result["verified"] = sameRecords(readRecords, NfcTagInfo.records(sent))
        result["readBack"] = readRecords
      }

      stopReaderMode()
      resolveOnce(result)
    } catch (e: Exception) {
      stopReaderMode()
      rejectOnce(
        if (messageToWrite != null) {
          WriteFailedException(e.message ?: "unknown error")
        } else {
          SessionFailedException(e.message ?: "unknown error")
        }
      )
    } finally {
      runCatching { ndef.close() }
    }
  }

  /**
   * Compared by record content, not raw bytes — a tag may legally return a
   * message whose framing differs from what was sent while carrying identical
   * data. Same reasoning as the Swift.
   */
  private fun sameRecords(a: List<Map<String, Any>>, b: List<Map<String, Any>>): Boolean {
    if (a.size != b.size) return false

    return a.zip(b).all { (left, right) ->
      left["tnf"] == right["tnf"] &&
        left["type"] == right["type"] &&
        left["payload"] == right["payload"]
    }
  }

  private fun stopReaderMode() {
    runCatching { adapter.disableReaderMode(activity) }
  }

  private fun resolveOnce(value: Map<String, Any?>) {
    if (settled.compareAndSet(false, true)) promise?.resolve(value)
  }

  private fun rejectOnce(exception: Throwable) {
    if (settled.compareAndSet(false, true)) {
      promise?.reject(
        (exception as? expo.modules.kotlin.exception.CodedException)
          ?: expo.modules.kotlin.exception.UnexpectedException(exception)
      )
    }
  }
}
