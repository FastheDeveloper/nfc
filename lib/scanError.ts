/**
 * Turning the library's errors into something a person can read.
 *
 * Phase 1 rendered `err.message` and got **nothing** — a scan that failed
 * looked identical to a scan that never happened. The cause is a deliberate
 * design choice upstream: every one of the library's error classes is
 * constructed with no arguments, so the meaning lives in the *class* and
 * `message` is always the empty string (DEVLOG §1.13). React treats `''` as
 * falsy, so `{error && <Card/>}` renders nothing at all.
 *
 * So we classify on the class, not the message.
 *
 * Two things to note about the import below. It reaches into
 * `react-native-nfc-manager/src/NfcError` rather than the package root, because
 * the root instantiates a `NativeEventEmitter` at module load and throws
 * outside a native runtime — that would make this module untestable. Metro and
 * Node both key their module cache on the resolved path, and the package's own
 * index imports the same file, so `instanceof` still matches errors thrown by
 * the library itself.
 *
 * And classification uses `instanceof` rather than `constructor.name` because
 * class names are not guaranteed to survive minification in a release build.
 * `constructor.name` appears only in the developer detail, where being wrong is
 * survivable.
 */

import { describeNativeError, expoCodeFor } from './nativeError';

export type ScanErrorKind =
  | 'cancelled'
  | 'not-ndef'
  | 'connection-lost'
  | 'timeout'
  | 'system-busy'
  | 'nfc-off'
  | 'unsupported'
  // Write-side kinds. Phase 3.
  | 'read-only'
  | 'too-big-for-tag'
  | 'write-failed'
  | 'unknown';

export type ScanError = {
  kind: ScanErrorKind;
  /** Short, user-facing. */
  title: string;
  /** One sentence of user-facing explanation, ideally actionable. */
  detail: string;
  /** Class name and raw message, for the collapsed Developer detail. */
  developer: string;
  /**
   * True when this mapping was derived from reading the library's source
   * rather than from watching it happen on a device. Only `cancelled` has been
   * observed so far (iOS, 2026-09-05). The UI does not currently surface this,
   * but PLATFORM-NOTES does, and it keeps us honest about what we know.
   */
  provisional: boolean;
};

/**
 * Our native module's exceptions.
 *
 * The table is keyed on the **Swift class names**, which is what we wrote and
 * what appears in Expo's cause chain. Expo separately derives a code from each
 * (`UserCancelledException` → `ERR_USER_CANCELLED`), so the lookup tries both
 * forms. Keying on one and matching on the other is exactly the bug that made a
 * cancelled scan render a "Could not read the tag" card after T9 (§T9a).
 *
 * `observed` marks what we have actually watched happen on hardware, which is
 * what `provisional` reports.
 */
const NATIVE_CODES: Record<
  string,
  { kind: ScanErrorKind; title: string; detail: string; observed?: boolean }
> = {
  UserCancelledException: {
    kind: 'cancelled',
    title: 'Scan cancelled',
    detail: 'No tag was read.',
    observed: true,
  },
  TimeoutException: {
    kind: 'timeout',
    title: 'Scan timed out',
    detail: 'No tag was detected in time. Try again and hold the tag steady.',
  },
  SystemBusyException: {
    kind: 'system-busy',
    title: 'NFC is busy',
    detail: 'The system NFC reader is in use. Wait a moment and try again.',
  },
  SessionFailedException: {
    kind: 'connection-lost',
    title: 'The scan session failed',
    detail: 'Something interrupted the scan. Try again.',
  },
  ConnectFailedException: {
    kind: 'connection-lost',
    title: 'Could not connect to the tag',
    detail: 'The tag moved away too soon. Hold it still against the phone.',
  },
  StatusFailedException: {
    kind: 'connection-lost',
    title: 'Could not read the tag',
    detail: 'The tag did not answer. Hold it still and try again.',
  },
  NoTagException: {
    kind: 'unknown',
    title: 'No tag found',
    detail: 'The session ended without finding a tag.',
  },
  NotNdefException: {
    kind: 'not-ndef',
    title: 'This tag is not NDEF formatted',
    detail: 'TapCard reads tags that store data in the NDEF format. This one does not yet.',
  },
  NfcUnavailableException: {
    kind: 'unsupported',
    title: 'NFC not available',
    detail: 'This device cannot read NFC tags.',
    observed: true,
  },
  TagReadOnlyException: {
    kind: 'read-only',
    title: 'This tag is locked',
    detail: 'It reports itself permanently read-only, so nothing was written.',
  },
  TagTooSmallException: {
    kind: 'too-big-for-tag',
    title: 'Too big for this tag',
    detail: 'The tag does not have room. Nothing was written.',
    observed: true,
  },
  WriteFailedException: {
    kind: 'write-failed',
    title: 'The write did not complete',
    detail: 'The tag may be partly written. Hold it steady and try again.',
  },
  InvalidMessageException: {
    kind: 'write-failed',
    title: 'Nothing to write',
    detail: 'The message could not be encoded for the tag.',
  },
  NoNfcSettingsException: {
    kind: 'unsupported',
    title: 'No NFC settings on iOS',
    detail: 'iOS has no NFC setting to open.',
    observed: true,
  },
};

/**
 * Expo's derived codes, built from the class names above rather than typed out
 * a second time. One list, two ways of matching it.
 */
const NATIVE_BY_EXPO_CODE: Record<string, (typeof NATIVE_CODES)[string]> = Object.fromEntries(
  Object.entries(NATIVE_CODES).map(([className, mapping]) => [expoCodeFor(className), mapping])
);

function lookupNative(className: string | null, code: string) {
  return (className ? NATIVE_CODES[className] : undefined) ?? NATIVE_BY_EXPO_CODE[code];
}

/** Everything we know how to say about a thrown value. */
export function toScanError(error: unknown): ScanError {
  // Our own module's exceptions — the only native errors that exist now that
  // the library is gone. The pre-flight refusal that used to be raised here in
  // JavaScript moved into Swift with T5, so it arrives as
  // `TagTooSmallException` like any other native error.
  const native = describeNativeError(error);
  const nativeMapping = lookupNative(native.className, native.code);

  if (nativeMapping) {
    return {
      kind: nativeMapping.kind,
      title: nativeMapping.title,
      // The native side often has more to say than a generic sentence —
      // TagTooSmallException carries the tag's own numbers, for instance — so
      // prefer its message when it gave us one.
      detail: native.message || nativeMapping.detail,
      developer: `${native.code}\n${native.chain.join('\n↳ ')}`,
      provisional: !nativeMapping.observed,
    };
  }

  return {
    kind: 'unknown',
    title: 'Could not read the tag',
    detail: 'Something went wrong during the scan. Try again.',
    developer: describe(error, fallbackName(error)),
    provisional: true,
  };
}

/**
 * Is this the user backing out?
 *
 * Worth its own function because the answer changes behaviour rather than
 * wording: a cancellation is **not an error**, and painting a red card at
 * someone who changed their mind is worse than the silent-nothing bug it
 * replaced.
 */
export function isCancellation(error: unknown): boolean {
  // Either implementation. The library throws a class; ours sends a code across
  // the bridge, where `instanceof` does not exist. Both mean the same thing to
  // every caller, which is what lets T9 swap them without touching a screen.
  const native = describeNativeError(error);

  // Both forms, for the same reason as the mapping table: the class name comes
  // from the cause chain, the ERR_ code from Expo's own derivation.
  return (
    native.className === 'UserCancelledException' ||
    native.code === expoCodeFor('UserCancelledException')
  );
}

/**
 * The developer detail. States the empty message explicitly rather than
 * printing nothing, because "there is no message" is the fact worth showing.
 */
function describe(error: unknown, className: string): string {
  if (error instanceof Error) {
    return error.message
      ? `${className}\nmessage: ${error.message}`
      : `${className}\nmessage: "" (empty)`;
  }

  return `${className}\nvalue: ${String(error)}`;
}

function fallbackName(error: unknown): string {
  if (error instanceof Error) return error.constructor?.name || 'Error';
  return typeof error;
}
