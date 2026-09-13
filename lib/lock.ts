/**
 * The rules around an operation that cannot be undone.
 *
 * Locking a tag burns its lock bits. It is a hardware change, not a software
 * one: the chip can be read forever and never written again, by any app, on
 * any phone, ever. There is no undo, no factory reset, and no clever APDU that
 * puts it back.
 *
 * Every other destructive action in this app is guarded by two taps, which is
 * right for a write — a write is reversible, you simply write something else.
 * Two taps is *not* right for this. The gate here is deliberately annoying,
 * and modelled on the pattern GitHub uses for deleting a repository: **type
 * the thing's name to prove you know which thing you are destroying.**
 *
 * That specific choice matters more than the friction. A confirmation dialog
 * measures willingness; typing the UID measures *attention*. The failure mode
 * worth designing against is not someone who wants to lock a tag — it is
 * someone who wants to lock a tag and is holding the wrong one.
 *
 * Pure — no react-native imports, so the gate is tested without a device and
 * without destroying anything.
 */

import { normaliseTagId } from './focus';

export type LockGate =
  /** Nothing scanned yet — there is nothing to confirm. */
  | { state: 'no-tag' }
  /** The tag says it is already read-only. Nothing to do, and nothing to lose. */
  | { state: 'already-locked' }
  /**
   * Not an NDEF tag, so there is no NDEF lock to apply.
   *
   * `writeLock` is a method on `NFCNDEFTag`. Locking the raw memory of a
   * non-NDEF chip is a different operation against a different interface, and
   * offering it here would be claiming to do something we do not do.
   */
  | { state: 'not-lockable' }
  /** Scanned, writable, and waiting for the UID to be typed correctly. */
  | { state: 'needs-confirmation'; expected: string }
  /** Typed correctly. The button may now be enabled, and only now. */
  | { state: 'armed'; tagId: string };

/** iOS `NFCNDEFStatus`; derived to the same numbers on Android. */
export const NDEF_STATUS = {
  NOT_SUPPORTED: 1,
  READ_WRITE: 2,
  READ_ONLY: 3,
} as const;

/**
 * Decide whether the lock button may be pressed.
 *
 * Note the order: `already-locked` is checked *before* the typed confirmation,
 * so someone cannot type their way into locking a tag that is already locked
 * and be told it succeeded. It did not succeed; there was nothing to do.
 */
export function lockGate(tagId: string | null, status: number | null, typed: string): LockGate {
  if (!tagId) return { state: 'no-tag' };

  if (status === NDEF_STATUS.READ_ONLY) return { state: 'already-locked' };
  if (status === NDEF_STATUS.NOT_SUPPORTED) return { state: 'not-lockable' };

  // Compared the same way the focus tag is: the same chip arrives formatted
  // two different ways depending on which read path produced it, and a user
  // who types exactly what is on screen must always be right.
  return normaliseTagId(typed) === normaliseTagId(tagId)
    ? { state: 'armed', tagId }
    : { state: 'needs-confirmation', expected: tagId };
}

/**
 * Did the lock actually take?
 *
 * Asked after the fact, by re-reading the tag. A lock that reports success and
 * did not happen is worse than a failure, because the tag goes into the world
 * believing it is protected — and unlike a failed write, you cannot simply try
 * again to find out.
 */
export function lockVerified(statusAfter: number | null): boolean {
  return statusAfter === NDEF_STATUS.READ_ONLY;
}

/** Plain language, used verbatim in the UI. No euphemisms. */
export const LOCK_WARNING =
  'This permanently makes the tag read-only. It can never be written again — not by this app, ' +
  'not by any app, not by any phone. There is no undo.';

export function describeStatus(status: number | null): string {
  switch (status) {
    case NDEF_STATUS.READ_WRITE:
      return 'Writable';
    case NDEF_STATUS.READ_ONLY:
      return 'Locked — read-only, permanently';
    case NDEF_STATUS.NOT_SUPPORTED:
      return 'Not an NDEF tag';
    default:
      return 'Unknown';
  }
}
