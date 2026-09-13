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
    return { code: typeof error, message: String(error), chain: [String(error)] };
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
    message: match?.[2] ?? innermost,
    chain,
  };
}
