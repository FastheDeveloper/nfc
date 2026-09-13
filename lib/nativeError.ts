/**
 * Getting our own error back out of Expo's wrapper.
 *
 * A native `Exception` thrown from an `AsyncFunction` does not arrive in
 * JavaScript as itself. Expo Modules wraps it, so `err.message` reads:
 *
 *   Calling the 'openNfcSettings' function has failed
 *   → Caused by: NoNfcSettingsException: iOS has no NFC setting to open. …
 *
 * The first line is the framework describing its own plumbing; the useful
 * sentence is the one we wrote, at the end of the chain. Rendering
 * `err.message` directly shows a user the plumbing.
 *
 * This is the mirror image of the `react-native-nfc-manager` problem in
 * DEVLOG §1.13. There, the message was empty and the meaning lived in the
 * class. Here the meaning is present but buried under a wrapper. Both break
 * the same reflex — `err.message` — and both need the error plumbing
 * understood rather than assumed. Owning the native side does not exempt you
 * from that; it just changes which layer surprises you.
 *
 * Pure: no imports, testable in plain Node.
 */

export type NativeErrorInfo = {
  /** Expo's error code when there is one, else the class name. */
  code: string;
  /**
   * The Swift/Kotlin class name, recovered from the cause chain.
   *
   * **Not the same as `code`.** Expo derives the code from the class name by
   * stripping the trailing `Exception`, splitting camelCase and upper-casing
   * it, so `UserCancelledException` reaches JavaScript as
   * `ERR_USER_CANCELLED` (`expo-modules-core/ios/Core/Exceptions/CodedError.swift:45`).
   *
   * Both are kept because matching on either alone is fragile: the code is
   * absent on some paths, and the class name is absent if a future Expo stops
   * embedding it in the message. See `expoCodeFor`.
   */
  className: string | null;
  /** The innermost message — ours, when we threw it. */
  message: string;
  /** Every link in the chain, outermost first. Useful in developer detail. */
  chain: string[];
};

/**
 * Expo joins causes with `→ Caused by:`. Matched loosely — the separator is a
 * framework implementation detail, not a contract, so a future change should
 * degrade to "show the whole message" rather than produce nonsense.
 */
const CAUSE_SEPARATOR = /\s*(?:→\s*)?Caused by:?\s*/;

export function describeNativeError(error: unknown): NativeErrorInfo {
  if (!(error instanceof Error)) {
    return {
      code: typeof error,
      className: null,
      message: String(error),
      chain: [String(error)],
    };
  }

  const chain = error.message
    .split(CAUSE_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);

  // The innermost link is the one we threw; fall back to the whole message.
  const innermost = chain.length ? chain[chain.length - 1] : error.message;

  // A link reads `ClassName: message`. Strip the class name for the user, but
  // keep it for the code when Expo did not give us one.
  const match = /^([A-Za-z_][\w.]*(?:Exception|Error)):\s*([\s\S]+)$/.exec(innermost);

  const codeFromError = (error as { code?: unknown }).code;

  return {
    code:
      typeof codeFromError === 'string' && codeFromError
        ? codeFromError
        : (match?.[1] ?? error.name),
    className: match?.[1] ?? null,
    message: match?.[2] ?? innermost,
    chain,
  };
}

/**
 * Reproduce Expo's class-name → code transformation.
 *
 * Mirrors `errorCodeFromString` in
 * `expo-modules-core/ios/Core/Exceptions/CodedError.swift`:
 *
 *   1. drop a trailing `Error` or `Exception` (and any generic parameters)
 *   2. insert `_` at every lowercase→uppercase boundary
 *   3. upper-case, prefix `ERR_`
 *
 *   UserCancelledException → UserCancelled → User_Cancelled → ERR_USER_CANCELLED
 *
 * Kept here so the mapping table can be written in terms of the class names we
 * actually wrote in Swift, with the codes derived from them — one source of
 * truth instead of two lists that can drift apart.
 */
export function expoCodeFor(className: string): string {
  const stripped = className.replace(/(Error|Exception)?(<.*>)?$/, '');
  return `ERR_${stripped.replace(/(.)([A-Z])/g, '$1_$2').toUpperCase()}`;
}
