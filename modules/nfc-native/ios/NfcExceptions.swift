import ExpoModulesCore

/**
 * Every error this module can produce, as a type.
 *
 * Expo's `Exception` gives each of these a **code** (the class name) and a
 * **message** (`reason`), both readable from JavaScript. That is the direct
 * answer to DEVLOG §1.13, where `react-native-nfc-manager`'s 24 error classes
 * all carry an empty message and force the caller to `instanceof` its way
 * through an undocumented hierarchy.
 *
 * Note that Expo still wraps these in a `FunctionCallException` on the way out,
 * so the JavaScript side unwraps the cause chain — see `lib/nativeError.ts`
 * and §T1a. Typed errors are necessary but not sufficient; the plumbing has to
 * be understood either way.
 */

internal final class NfcUnavailableException: Exception {
  override var reason: String {
    "This device cannot read NFC tags. No iPad has NFC, and the Simulator never does."
  }
}

internal final class NoTagException: Exception {
  override var reason: String {
    "The session ended without finding a tag."
  }
}

internal final class NotNdefException: Exception {
  override var reason: String {
    "This tag does not hold NDEF data. It may need formatting first."
  }
}

internal final class UserCancelledException: Exception {
  override var reason: String {
    "The scan was cancelled."
  }
}

internal final class TimeoutException: Exception {
  override var reason: String {
    "The scan timed out before a tag was presented."
  }
}

internal final class SystemBusyException: Exception {
  override var reason: String {
    "The NFC reader is busy. Wait a moment and try again."
  }
}

/// Carries the underlying description, because these are the ones we have not
/// seen yet and guessing at wording would be worse than passing it through.
internal final class ConnectFailedException: GenericException<String> {
  override var reason: String {
    "Could not connect to the tag: \(param)"
  }
}

internal final class StatusFailedException: GenericException<String> {
  override var reason: String {
    "Could not read the tag's status: \(param)"
  }
}

internal final class SessionFailedException: GenericException<String> {
  override var reason: String {
    "The NFC session failed: \(param)"
  }
}
