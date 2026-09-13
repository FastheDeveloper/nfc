import CoreNFC
import ExpoModulesCore

/**
 * One CoreNFC read, start to finish.
 *
 * This is the part `react-native-nfc-manager` was hiding, and it is worth
 * seeing in full, because none of it is JavaScript-shaped:
 *
 *   - CoreNFC is **delegate and callback** based. A read is four nested
 *     asynchronous steps (begin → detect → connect → query → read), each with
 *     its own error, and none of them return anything.
 *   - A JavaScript `Promise` must be settled **exactly once**. Every failure
 *     path below therefore has to route through one place, or the app either
 *     hangs forever or crashes on a double-resolve.
 *   - The session object must be **retained** or ARC will deallocate it
 *     mid-scan and the sheet will vanish with no error at all.
 *
 * The library does all of this too. Writing it out is the point: a team that
 * owns this file can fix a decoding bug in an afternoon instead of waiting for
 * a maintainer.
 *
 * ⚠️ Only one CoreNFC session may be active per app. While Phase 4 is in
 * progress this module and the library both exist, so their scans must not
 * overlap — the second one to start simply fails.
 */
@available(iOS 13.0, *)
final class NfcReadSession: NSObject, NFCTagReaderSessionDelegate {
  private var session: NFCTagReaderSession?
  private var promise: Promise?

  /// Guards the promise. `didInvalidateWithError` can arrive after a normal
  /// completion — a timeout racing a successful read, for instance — so
  /// "settle once" has to be enforced rather than assumed.
  private let lock = NSLock()

  /// Held by the module so ARC does not collect us while a scan is running.
  func start(alertMessage: String, promise: Promise) {
    guard NFCTagReaderSession.readingAvailable else {
      promise.reject(NfcUnavailableException())
      return
    }

    self.promise = promise

    // Polling options are entitlement-gated, and not uniformly.
    //
    // `.iso14443` covers NTAG and MIFARE — everything this app targets — and
    // `.iso15693` is covered by the same `TAG` format we already hold. But
    // `.iso18092` (FeliCa) additionally requires
    // `com.apple.developer.nfc.readersession.felica.systemcodes`, and asking
    // for it without that key fails the **entire session** with "Missing
    // required entitlement" — not just that one polling mode.
    //
    // The first version of this file included `.iso18092` on the reasoning that
    // a wider net would produce better errors for unexpected tags. It produced
    // a session that could not start at all. Ask only for what you can sign
    // for. (DEVLOG §4, and the same lesson as §1.9 from the other direction.)
    guard
      let session = NFCTagReaderSession(
        pollingOption: [.iso14443, .iso15693],
        delegate: self,
        queue: nil
      )
    else {
      settle(rejecting: NfcUnavailableException())
      return
    }

    session.alertMessage = alertMessage
    self.session = session
    session.begin()
  }

  // MARK: - NFCTagReaderSessionDelegate

  func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {
    // Nothing to do. Required by the protocol, and a useful place to breakpoint
    // when the sheet appears but nothing else happens.
  }

  func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
    // The only place a cancel or a timeout surfaces. Note that a *successful*
    // read also invalidates the session, which is why `settle` is guarded —
    // this fires afterwards and must not overwrite the result.
    settle(rejecting: NfcReaderErrors.map(error))
  }

  func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
    guard let tag = tags.first else {
      finish(session, rejecting: NoTagException())
      return
    }

    session.connect(to: tag) { [weak self] error in
      guard let self else { return }

      if let error {
        self.finish(session, rejecting: ConnectFailedException(error.localizedDescription))
        return
      }

      guard let ndefTag = NfcTagInfo.ndefTag(from: tag) else {
        self.finish(session, rejecting: NotNdefException())
        return
      }

      self.readNdef(from: ndefTag, tag: tag, session: session)
    }
  }

  // MARK: - Reading

  /**
   * Status first, then the message.
   *
   * `queryNDEFStatus` is the call Phases 1–2 concluded did not exist (DEVLOG
   * §3.1). It reports both whether the tag is writable and its real capacity —
   * 137 bytes on the NTAG213s this project uses.
   */
  private func readNdef(from ndefTag: NFCNDEFTag, tag: NFCTag, session: NFCTagReaderSession) {
    ndefTag.queryNDEFStatus { [weak self] status, capacity, error in
      guard let self else { return }

      if let error {
        self.finish(session, rejecting: StatusFailedException(error.localizedDescription))
        return
      }

      ndefTag.readNDEF { message, readError in
        // A blank but formatted tag is not a failure. CoreNFC reports it as an
        // error here rather than as an empty message, so the distinction has to
        // be made by status: a readable tag with nothing on it is `.readWrite`
        // or `.readOnly`, never `.notSupported`.
        if readError != nil && status == .notSupported {
          self.finish(session, rejecting: NotNdefException())
          return
        }

        let payload: [String: Any] = [
          "id": NfcTagInfo.identifier(of: tag),
          "tech": NfcTagInfo.tech(of: tag),
          "status": status.rawValue,
          "capacity": capacity,
          "ndefMessage": NfcTagInfo.records(from: message),
        ]

        session.alertMessage = "Tag read."
        session.invalidate()
        self.settle(resolving: payload)
      }
    }
  }

  // Tag → bridge conversions now live in NfcTagInfo, shared with the write
  // session so a read and a write can never disagree about what a UID is.

  // MARK: - Settling exactly once

  private func finish(_ session: NFCTagReaderSession, rejecting exception: Exception) {
    session.invalidate(errorMessage: exception.reason)
    settle(rejecting: exception)
  }

  private func settle(resolving value: [String: Any]) {
    lock.lock()
    defer { lock.unlock() }

    guard let promise else { return }
    self.promise = nil
    self.session = nil
    promise.resolve(value)
  }

  private func settle(rejecting exception: Exception) {
    lock.lock()
    defer { lock.unlock() }

    guard let promise else { return }
    self.promise = nil
    self.session = nil
    promise.reject(exception)
  }

  // CoreNFC error-code translation lives in NfcReaderErrors, shared with the
  // write session.
}
