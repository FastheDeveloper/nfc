/**
 * Our own refusal, as distinct from the tag's.
 *
 * The first version of `writeNdef` threw the library's `NfcError.TagSizeTooSmall`
 * from its own pre-flight check. That was a mistake: it made *our* refusal
 * indistinguishable from CoreNFC's, so a failed write could not tell us
 * whether the tag had reported a capacity or not — which was precisely the
 * question we were trying to answer.
 *
 * A dedicated class also lets the message carry the real numbers instead of a
 * generic apology.
 */

import type { NdefStatusValue } from './nfc';

export type PreflightReason = 'read-only' | 'too-big';

export class WritePreflightError extends Error {
  constructor(
    readonly reason: PreflightReason,
    /** What the tag itself said when asked, before anything was written. */
    readonly reported: { status: NdefStatusValue; capacity: number | null },
    /** Bytes we were about to send. */
    readonly needed: number
  ) {
    super(reason);
    this.name = 'WritePreflightError';
  }
}
