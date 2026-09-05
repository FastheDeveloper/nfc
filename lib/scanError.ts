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

import * as NfcError from 'react-native-nfc-manager/src/NfcError';

import { WritePreflightError } from './writeError';

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
 * The mapping table.
 *
 * `className` is written out rather than read from the constructor so the
 * developer detail stays correct after minification. Order matters only for
 * subclasses, and the library's error classes are all siblings.
 */
const MAPPINGS: {
  type: new () => Error;
  className: string;
  kind: ScanErrorKind;
  title: string;
  detail: string;
}[] = [
  {
    type: NfcError.UserCancel,
    className: 'NfcError.UserCancel',
    kind: 'cancelled',
    title: 'Scan cancelled',
    detail: 'No tag was read.',
  },
  {
    type: NfcError.Timeout,
    className: 'NfcError.Timeout',
    kind: 'timeout',
    title: 'Scan timed out',
    detail: 'No tag was detected in time. Try again and hold the tag steady.',
  },
  {
    type: NfcError.TagConnectionLost,
    className: 'NfcError.TagConnectionLost',
    kind: 'connection-lost',
    title: 'Lost contact with the tag',
    detail: 'The tag moved away mid-read. Hold it still against the phone.',
  },
  {
    type: NfcError.TagNotConnected,
    className: 'NfcError.TagNotConnected',
    kind: 'connection-lost',
    title: 'Lost contact with the tag',
    detail: 'The tag was not in range long enough. Hold it still against the phone.',
  },
  {
    type: NfcError.RetryExceeded,
    className: 'NfcError.RetryExceeded',
    kind: 'connection-lost',
    title: 'Could not read the tag',
    detail: 'Several attempts failed. Reposition the tag and try again.',
  },
  {
    type: NfcError.SessionInvalidated,
    className: 'NfcError.SessionInvalidated',
    kind: 'connection-lost',
    title: 'The scan session ended',
    detail: 'The reader session closed before the tag was read. Try again.',
  },
  {
    type: NfcError.SystemBusy,
    className: 'NfcError.SystemBusy',
    kind: 'system-busy',
    title: 'NFC is busy',
    detail: 'The system NFC reader is in use. Wait a moment and try again.',
  },
  {
    type: NfcError.RadioDisabled,
    className: 'NfcError.RadioDisabled',
    kind: 'nfc-off',
    title: 'NFC is switched off',
    detail: 'Turn NFC on in system settings, then scan again.',
  },
  {
    type: NfcError.UnsupportedFeature,
    className: 'NfcError.UnsupportedFeature',
    kind: 'unsupported',
    title: 'Not supported on this device',
    detail: 'This device cannot read this kind of tag.',
  },
  {
    type: NfcError.TagNotWritable,
    className: 'NfcError.TagNotWritable',
    kind: 'read-only',
    title: 'This tag is locked',
    detail: 'It has been made permanently read-only and cannot be changed.',
  },
  {
    type: NfcError.TagSizeTooSmall,
    className: 'NfcError.TagSizeTooSmall',
    kind: 'too-big-for-tag',
    title: 'Too big for this tag',
    detail: 'The tag does not have room. Shorten your card, or write a link instead.',
  },
  {
    type: NfcError.TagUpdateFailure,
    className: 'NfcError.TagUpdateFailure',
    kind: 'write-failed',
    title: 'The write did not complete',
    detail: 'The tag may be partly written. Hold it steady and try again.',
  },
  {
    type: NfcError.ZeroLengthMessage,
    className: 'NfcError.ZeroLengthMessage',
    kind: 'write-failed',
    title: 'Nothing to write',
    detail: 'The message was empty.',
  },
  {
    type: NfcError.FirstNdefInvalid,
    className: 'NfcError.FirstNdefInvalid',
    kind: 'not-ndef',
    title: 'This tag is not NDEF formatted',
    detail: 'The tag holds data TapCard cannot read. Writing to it will format it first.',
  },
];

/**
 * Hints that Android used when a tag does not support the NDEF technology.
 *
 * Unlike iOS, which returns a numeric `NFCError:<code>` that the library maps
 * to a class, Android's failure for an unformatted tag arrives as a plain
 * string wrapped in `NfcErrorBase`. **This list is a guess from the Android
 * source and has never been seen on a device** (task H1) — which is why
 * anything it matches is flagged `provisional`.
 */
const NOT_NDEF_HINTS = ['ndef', 'tech', 'technology', 'not supported'];

/** Everything we know how to say about a thrown value. */
export function toScanError(error: unknown): ScanError {
  // Ours first. This one is checked before the library's classes because it is
  // the only error in the app that carries measured numbers, and because
  // `provisional` is genuinely false for it — we watched our own code decide.
  if (error instanceof WritePreflightError) {
    const { reason, reported, needed } = error;
    const capacity =
      reported.capacity != null ? `${reported.capacity} bytes` : 'no capacity (it did not say)';

    return reason === 'read-only'
      ? {
          kind: 'read-only',
          title: 'This tag is locked',
          detail: 'The tag reports itself as read-only, so nothing was written.',
          developer: `WritePreflightError: read-only\ntag reported status ${reported.status}, ${capacity}\nnothing was sent`,
          provisional: false,
        }
      : {
          kind: 'too-big-for-tag',
          title: 'Too big for this tag',
          detail: `The tag reports ${capacity} and this needs ${needed}. Nothing was written — shorten your card, or write a link instead.`,
          developer: `WritePreflightError: too-big\ntag reported status ${reported.status}, ${capacity}\nneeded ${needed} bytes\nrefused before writing — the tag is untouched`,
          provisional: false,
        };
  }

  for (const mapping of MAPPINGS) {
    if (error instanceof mapping.type) {
      return {
        kind: mapping.kind,
        title: mapping.title,
        detail: mapping.detail,
        developer: describe(error, mapping.className),
        provisional: mapping.kind !== 'cancelled',
      };
    }
  }

  // An NfcErrorBase that matched no subclass carries a real message string —
  // this is the Android path, where the native side reports text rather than a
  // code.
  if (error instanceof NfcError.NfcErrorBase && error.message) {
    const lower = error.message.toLowerCase();

    if (NOT_NDEF_HINTS.some((hint) => lower.includes(hint))) {
      return {
        kind: 'not-ndef',
        title: 'This tag is not NDEF formatted',
        detail: 'TapCard reads tags that store data in the NDEF format. This one does not yet.',
        developer: describe(error, 'NfcError.NfcErrorBase'),
        provisional: true,
      };
    }
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
  return error instanceof NfcError.UserCancel;
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
