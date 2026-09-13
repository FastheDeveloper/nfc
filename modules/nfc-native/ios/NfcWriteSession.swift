import CoreNFC
import ExpoModulesCore

/**
 * One CoreNFC write, start to finish.
 *
 * The same session discipline as `NfcReadSession` — settle exactly once,
 * retain the session, route every failure through one place — with two extra
 * responsibilities that only exist because a write changes something:
 *
 *   1. **Ask before acting.** `queryNDEFStatus` reports read-only status and
 *      real capacity. Refusing here leaves the tag untouched; failing partway
 *      through `writeNDEF` can leave it half-written. This mirrors the JS-side
 *      pre-flight from DEVLOG §3.3 — and, as there, the refusal is our own
 *      error type, never CoreNFC's, so "we refused" and "the tag refused" stay
 *      distinguishable.
 *   2. **Verify.** A write that reports success and did not happen is the
 *      worst outcome available, so the tag is read back inside the same
 *      session and compared. A mismatch is *reported*, never thrown: the write
 *      did occur, and "it worked but I could not confirm it" is more useful
 *      than a fabricated failure.
 *
 * Nothing here calls `makeReadOnly`. Locking a tag is permanent and is Phase 5.
 */
@available(iOS 13.0, *)
final class NfcWriteSession: NSObject, NFCTagReaderSessionDelegate {
  private var session: NFCTagReaderSession?
  private var promise: Promise?
  private var message: NFCNDEFMessage?
  private var expectedBytes: [Int] = []

  private let lock = NSLock()

  func start(alertMessage: String, bytes: [UInt8], promise: Promise) {
    guard NFCTagReaderSession.readingAvailable else {
      promise.reject(NfcUnavailableException())
      return
    }

    // Our own encoder produced these bytes (`lib/ndefEncode.ts`). CoreNFC
    // parses them back into a message, which is a free correctness check: a
    // malformed message is rejected here, before a tag is ever involved.
    guard let parsed = NFCNDEFMessage(data: Data(bytes)) else {
      promise.reject(InvalidMessageException())
      return
    }

    self.promise = promise
    self.message = parsed
    self.expectedBytes = bytes.map(Int.init)

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

  func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

  func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
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

      self.preflight(ndefTag, tag: tag, session: session)
    }
  }

  // MARK: - Ask, then write

  private func preflight(_ ndefTag: NFCNDEFTag, tag: NFCTag, session: NFCTagReaderSession) {
    ndefTag.queryNDEFStatus { [weak self] status, capacity, error in
      guard let self, let message = self.message else { return }

      if let error {
        self.finish(session, rejecting: StatusFailedException(error.localizedDescription))
        return
      }

      switch status {
      case .notSupported:
        self.finish(session, rejecting: NotNdefException())
        return
      case .readOnly:
        // Permanent, and nothing we can do about it. Note this is the tag
        // reporting itself locked, not a failed attempt — the tag is untouched.
        self.finish(session, rejecting: TagReadOnlyException(Int(capacity)))
        return
      case .readWrite:
        break
      @unknown default:
        break
      }

      if self.expectedBytes.count > capacity {
        self.finish(
          session,
          rejecting: TagTooSmallException(
            "the tag reports \(capacity) bytes and this needs \(self.expectedBytes.count)"
          )
        )
        return
      }

      ndefTag.writeNDEF(message) { writeError in
        if let writeError {
          self.finish(session, rejecting: WriteFailedException(writeError.localizedDescription))
          return
        }

        self.verify(ndefTag, tag: tag, status: status, capacity: Int(capacity), session: session)
      }
    }
  }

  // MARK: - Verify

  private func verify(
    _ ndefTag: NFCNDEFTag,
    tag: NFCTag,
    status: NFCNDEFStatus,
    capacity: Int,
    session: NFCTagReaderSession
  ) {
    ndefTag.readNDEF { [weak self] readBack, _ in
      guard let self else { return }

      let readRecords = NfcTagInfo.records(from: readBack)
      let sentRecords = NfcTagInfo.records(from: self.message)

      // Compared by record content rather than raw bytes: a tag may legally
      // return a message whose framing differs from what we sent (short vs
      // long record form, for instance) while carrying identical data. What
      // matters is that the *content* survived.
      let verified = Self.sameRecords(readRecords, sentRecords)

      session.alertMessage = verified ? "Tag written." : "Written, but not confirmed."
      session.invalidate()

      self.settle(resolving: [
        "id": NfcTagInfo.identifier(of: tag),
        "tech": NfcTagInfo.tech(of: tag),
        "status": status.rawValue,
        "capacity": capacity,
        "written": self.expectedBytes.count,
        "verified": verified,
        "readBack": readRecords,
      ])
    }
  }

  private static func sameRecords(_ a: [[String: Any]], _ b: [[String: Any]]) -> Bool {
    guard a.count == b.count else { return false }

    for (left, right) in zip(a, b) {
      guard
        left["tnf"] as? Int == right["tnf"] as? Int,
        left["type"] as? [Int] == right["type"] as? [Int],
        left["payload"] as? [Int] == right["payload"] as? [Int]
      else {
        return false
      }
    }

    return true
  }

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
}
