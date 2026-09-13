import CoreNFC
import ExpoModulesCore

/**
 * Making a tag permanently read-only.
 *
 * This is the only operation in the project that cannot be undone. `writeLock`
 * burns the chip's lock bits — a hardware change. The tag can be read forever
 * and never written again, by any app, on any phone. There is no undo, no
 * factory reset, and no clever command that puts it back.
 *
 * The session is written separately from `NfcWriteSession` rather than added
 * as a flag to it. A boolean parameter that sometimes destroys the tag is
 * exactly the kind of thing that gets passed by accident from a refactor three
 * months later. Two call sites, two intentions, no shared branch.
 *
 * The order below is the safety property, and it is the reverse of what you
 * might reach for:
 *
 *   1. Read what is on the tag, and its status.
 *   2. Refuse if it is already locked, or not NDEF.
 *   3. Lock.
 *   4. Re-read the status and confirm it actually took.
 *
 * Step 4 matters more here than anywhere else in the app. A failed write is
 * recoverable — write again. A lock that reports success and did not happen
 * sends a tag into the world believing it is protected, and you cannot retry to
 * find out, because retrying is itself the destructive act.
 */
@available(iOS 13.0, *)
final class NfcLockSession: NSObject, NFCTagReaderSessionDelegate {
  private var session: NFCTagReaderSession?
  private var promise: Promise?

  private let lock = NSLock()

  func start(alertMessage: String, promise: Promise) {
    guard NFCTagReaderSession.readingAvailable else {
      promise.reject(NfcUnavailableException())
      return
    }

    self.promise = promise

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

      self.lockIfAllowed(ndefTag, tag: tag, session: session)
    }
  }

  // MARK: - Ask, refuse, lock, verify

  private func lockIfAllowed(_ ndefTag: NFCNDEFTag, tag: NFCTag, session: NFCTagReaderSession) {
    ndefTag.queryNDEFStatus { [weak self] status, capacity, error in
      guard let self else { return }

      if let error {
        self.finish(session, rejecting: StatusFailedException(error.localizedDescription))
        return
      }

      switch status {
      case .readOnly:
        // Not a failure of ours, and nothing was changed. Reported distinctly
        // so the UI can say "already locked" rather than "lock failed", which
        // would imply something went wrong that did not.
        self.finish(session, rejecting: AlreadyLockedException())
        return
      case .notSupported:
        self.finish(session, rejecting: NotNdefException())
        return
      case .readWrite:
        break
      @unknown default:
        self.finish(session, rejecting: NotNdefException())
        return
      }

      // The point of no return.
      ndefTag.writeLock { lockError in
        if let lockError {
          self.finish(session, rejecting: LockFailedException(lockError.localizedDescription))
          return
        }

        self.verify(ndefTag, tag: tag, capacity: Int(capacity), session: session)
      }
    }
  }

  /**
   * Confirm the lock took, by asking the tag again.
   *
   * Unlike the write path, a mismatch here is **not** reported as a soft
   * warning. If the status does not come back read-only, we do not know what
   * state the chip is in, and saying "probably fine" about an irreversible
   * hardware operation is worse than saying nothing.
   */
  private func verify(
    _ ndefTag: NFCNDEFTag,
    tag: NFCTag,
    capacity: Int,
    session: NFCTagReaderSession
  ) {
    ndefTag.queryNDEFStatus { [weak self] statusAfter, _, _ in
      guard let self else { return }

      let locked = statusAfter == .readOnly

      session.alertMessage = locked ? "Tag locked." : "Locked, but could not confirm."
      session.invalidate()

      self.settle(resolving: [
        "id": NfcTagInfo.identifier(of: tag),
        "tech": NfcTagInfo.tech(of: tag),
        "statusAfter": statusAfter.rawValue,
        "capacity": capacity,
        "verified": locked,
      ])
    }
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
