/**
 * A focus session you cannot end without walking to the tag.
 *
 * The idea is older than this app — Foqos, TapBlok, nfcGuard and others all
 * converge on it — and they converge because the insight is not about NFC at
 * all:
 *
 *   **The friction is geography, not the gesture.** Tapping costs a second.
 *   What costs you is that the tag is downstairs. The tag's *location* is the
 *   product; NFC is merely what makes a location enforceable.
 *
 * Three decisions follow from that, and each one is a rule in this file.
 *
 * **One tag, two meanings.** The same tap starts a session when idle and ends
 * one when focused. Two tags would mean two objects to lose and two habits to
 * build; one tag is one ritual.
 *
 * **The timer counts up, never down.** A countdown invites you to wait it out
 * on the sofa — the session ends whether or not you did anything. Counting up
 * measures what actually happened.
 *
 * **A broken session is recorded, not hidden.** The escape hatch exists,
 * because a commitment device with no way out is one you delete. But taking it
 * costs a permanent, visible mark. That is the entire mechanism: not
 * prevention, which is impossible, but an honest record you have to look at.
 *
 * Pure — no react-native imports, no storage, so every rule here is tested in
 * plain Node.
 */

export type SessionOutcome =
  /** Ended by tapping the tag, as promised. */
  | 'completed'
  /** Ended through the escape hatch. Permanent, and deliberately visible. */
  | 'broken';

export type FocusSession = {
  id: string;
  /** Which tag started it — so a swapped tag is detectable later. */
  tagId: string;
  startedAt: number;
  endedAt: number;
  outcome: SessionOutcome;
  /** Optional note when a session was broken. Never required. */
  reason?: string;
};

/** What a tap should do, given what the app currently knows. */
export type TapVerdict =
  /** No tag bound yet — this one becomes *the* tag. */
  | { action: 'bind' }
  /** Idle, and it's the right tag. Begin. */
  | { action: 'start' }
  /** Focused, and it's the right tag. You walked over here; you're done. */
  | { action: 'end' }
  /**
   * Right state, wrong tag.
   *
   * This is the rule that makes the whole thing mean anything. Accept any tag
   * and the ritual is "own a sticker" rather than "go to the place".
   */
  | { action: 'wrong-tag'; expected: string };

/**
 * The core decision, and the only place it is made.
 *
 * Tag identifiers are compared case-insensitively with separators stripped,
 * because the same chip is reported as `04C4FC91DF2A81` by one read path and
 * `04:c4:fc:91:df:2a:81` by another. A mismatch there would look like a
 * different tag, which is a maddening bug to chase.
 */
export function verdictForTap(
  scannedTagId: string,
  boundTagId: string | null,
  isFocused: boolean
): TapVerdict {
  if (!boundTagId) return { action: 'bind' };

  if (normaliseTagId(scannedTagId) !== normaliseTagId(boundTagId)) {
    return { action: 'wrong-tag', expected: boundTagId };
  }

  return isFocused ? { action: 'end' } : { action: 'start' };
}

export function normaliseTagId(id: string): string {
  return id.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

// ---------------------------------------------------------------------------
// Reading the record
// ---------------------------------------------------------------------------

export type FocusStats = {
  sessions: number;
  completed: number;
  /** Never decreases except by clearing everything, which needs the tag. */
  broken: number;
  totalMs: number;
  longestMs: number;
  /** Consecutive completed sessions, most recent first. Broken resets it. */
  streak: number;
};

export function focusStats(history: readonly FocusSession[]): FocusStats {
  const completed = history.filter((s) => s.outcome === 'completed');

  return {
    sessions: history.length,
    completed: completed.length,
    broken: history.length - completed.length,
    totalMs: history.reduce((sum, s) => sum + duration(s), 0),
    longestMs: history.reduce((max, s) => Math.max(max, duration(s)), 0),
    streak: currentStreak(history),
  };
}

export function duration(session: FocusSession): number {
  // Clamped: a clock change mid-session must not produce a negative duration
  // that then poisons every total on the screen.
  return Math.max(0, session.endedAt - session.startedAt);
}

/**
 * Consecutive completed sessions, counting back from the newest.
 *
 * History is newest-first, and a single broken session ends the run. That is
 * harsher than "most of them went fine", and deliberately so — the number is
 * only worth looking at if it can actually be lost.
 */
function currentStreak(history: readonly FocusSession[]): number {
  let streak = 0;

  for (const session of history) {
    if (session.outcome !== 'completed') break;
    streak += 1;
  }

  return streak;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/**
 * `1h 23m`, `45m`, `12s`.
 *
 * Seconds are shown only under a minute. A focus session reported as
 * "1h 23m 07s" invites you to watch the seconds tick, which is the opposite of
 * what a focus timer is for.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/** A short, non-judgemental description of one entry in the record. */
export function describeSession(session: FocusSession): string {
  const length = formatDuration(duration(session));

  return session.outcome === 'completed' ? `${length} focused` : `${length}, ended early`;
}
