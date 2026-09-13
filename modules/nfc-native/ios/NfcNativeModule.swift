import CoreNFC
import ExpoModulesCore

/**
 * TapCard's own NFC bridge — iOS side.
 *
 * Phase 4 replaces `react-native-nfc-manager` rather than working around it.
 * The reasons are recorded in DEVLOG §2.3 and §4: three decoding defects, type
 * definitions that are invalid TypeScript, and a package root that throws
 * outside a native runtime. None of that is unusual for an unmaintained
 * dependency, and none of it is fixable from JavaScript.
 *
 * This first slice answers questions about NFC rather than doing NFC, because
 * it is the smallest thing that proves the whole toolchain: Swift → Expo
 * Modules → TypeScript → the app, with a rebuild in between.
 */
public class NfcNativeModule: Module {
  /**
   * Held for the life of the module, not the scan.
   *
   * CoreNFC's session is retained by this object, and this object has to be
   * retained by something — a local variable inside the function would be
   * deallocated the moment it returned, taking the session with it and making
   * the sheet disappear with no error. This is the single easiest way to get a
   * CoreNFC integration subtly wrong.
   */
  private var readSession: Any?

  public func definition() -> ModuleDefinition {
    Name("NfcNative")

    /// Does this device have NFC hardware the app is allowed to use?
    ///
    /// `readingAvailable` is the only honest answer available on iOS. It is
    /// false on every iPad, on iPhones before the 7, and — importantly for
    /// anyone debugging — on the Simulator.
    Function("isSupported") { () -> Bool in
      return NFCNDEFReaderSession.readingAvailable
    }

    /// Whether NFC is *switched on*.
    ///
    /// On Android this is a real, user-controllable runtime state. On iOS the
    /// question is meaningless: there is no NFC toggle anywhere in Settings,
    /// so the only truthful answer is "yes, if the hardware supports it".
    ///
    /// We return `readingAvailable` again, deliberately, and the TypeScript
    /// layer reports *why* rather than pretending the two platforms answered
    /// the same question. `react-native-nfc-manager` hardcodes `true` here
    /// (DEVLOG §1.5), which is nearly right but loses the distinction between
    /// "on" and "there is no such switch".
    Function("isEnabled") { () -> Bool in
      return NFCNDEFReaderSession.readingAvailable
    }

    /// Is there an NFC settings screen to send the user to? Never, on iOS.
    Function("canOpenSettings") { () -> Bool in
      return false
    }

    /// Deliberately throws.
    ///
    /// A cross-platform API that silently no-ops here would be lying: the
    /// caller asked us to send the user somewhere and we did not. Throwing a
    /// *typed* error with a real message lets the JS layer decide — and note
    /// that unlike the library's error classes, this one carries a message and
    /// a code rather than an empty string (DEVLOG §1.13).
    AsyncFunction("openNfcSettings") { () throws in
      throw NoNfcSettingsException()
    }

    /**
     * Read one tag.
     *
     * `AsyncFunction` hands us a `Promise`, which is what makes CoreNFC's
     * delegate callbacks expressible as an `await` in JavaScript. The whole
     * job of `NfcReadSession` is to settle that promise exactly once, from
     * whichever of five asynchronous paths gets there first.
     */
    AsyncFunction("readTag") { (alertMessage: String, promise: Promise) in
      guard #available(iOS 13.0, *) else {
        promise.reject(NfcUnavailableException())
        return
      }

      let session = NfcReadSession()
      self.readSession = session
      session.start(alertMessage: alertMessage, promise: promise)
    }
  }
}

/// Expo's `Exception` gives us `NoNfcSettingsException` as the code and the
/// `reason` below as the message, both readable from JavaScript.
internal final class NoNfcSettingsException: Exception {
  override var reason: String {
    "iOS has no NFC setting to open. NFC is available whenever the hardware supports it."
  }
}
