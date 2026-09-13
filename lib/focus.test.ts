import { describe, expect, it } from '@jest/globals';

import {
  describeSession,
  duration,
  focusStats,
  formatDuration,
  normaliseTagId,
  verdictForTap,
  type FocusSession,
} from './focus';

const MINUTE = 60_000;

const session = (
  overrides: Partial<FocusSession> & Pick<FocusSession, 'outcome'>
): FocusSession => ({
  id: 's',
  tagId: '04C4FC91DF2A81',
  startedAt: 0,
  endedAt: 25 * MINUTE,
  ...overrides,
});

describe('verdictForTap — the one decision that matters', () => {
  it('binds the first tag it ever sees', () => {
    expect(verdictForTap('04C4FC91DF2A81', null, false)).toEqual({ action: 'bind' });
  });

  it('starts a session when idle and the tag matches', () => {
    expect(verdictForTap('04C4FC91DF2A81', '04C4FC91DF2A81', false)).toEqual({ action: 'start' });
  });

  it('ends a session when focused and the tag matches', () => {
    expect(verdictForTap('04C4FC91DF2A81', '04C4FC91DF2A81', true)).toEqual({ action: 'end' });
  });

  /**
   * The rule the whole thing rests on. Accept any tag and the ritual becomes
   * "own a sticker" rather than "go to the place where the sticker lives".
   */
  it('refuses a different tag, in either state', () => {
    expect(verdictForTap('DEADBEEF', '04C4FC91DF2A81', false)).toEqual({
      action: 'wrong-tag',
      expected: '04C4FC91DF2A81',
    });
    expect(verdictForTap('DEADBEEF', '04C4FC91DF2A81', true)).toMatchObject({
      action: 'wrong-tag',
    });
  });

  /**
   * The same physical chip is reported as `04C4FC91DF2A81` by one read path and
   * `04:c4:fc:91:df:2a:81` by another. Treating those as different tags would
   * be a maddening bug: the right chip, in your hand, silently rejected.
   */
  it('treats formatting differences as the same tag', () => {
    expect(verdictForTap('04:c4:fc:91:df:2a:81', '04C4FC91DF2A81', false)).toEqual({
      action: 'start',
    });
  });

  it('normalises case and separators', () => {
    expect(normaliseTagId('04:c4:fc')).toBe('04C4FC');
    expect(normaliseTagId('04C4FC')).toBe('04C4FC');
  });
});

describe('duration', () => {
  it('measures the session', () => {
    expect(duration(session({ outcome: 'completed' }))).toBe(25 * MINUTE);
  });

  /**
   * A clock change mid-session must not produce a negative duration, which
   * would then poison every total on the screen.
   */
  it('never returns a negative, even if the clock moved backwards', () => {
    expect(duration(session({ outcome: 'completed', startedAt: 100, endedAt: 0 }))).toBe(0);
  });
});

describe('focusStats', () => {
  const history: FocusSession[] = [
    session({ id: '1', outcome: 'completed', startedAt: 0, endedAt: 30 * MINUTE }),
    session({ id: '2', outcome: 'completed', startedAt: 0, endedAt: 20 * MINUTE }),
    session({ id: '3', outcome: 'broken', startedAt: 0, endedAt: 5 * MINUTE }),
    session({ id: '4', outcome: 'completed', startedAt: 0, endedAt: 45 * MINUTE }),
  ];

  it('counts what happened', () => {
    expect(focusStats(history)).toMatchObject({
      sessions: 4,
      completed: 3,
      broken: 1,
      longestMs: 45 * MINUTE,
      totalMs: 100 * MINUTE,
    });
  });

  /** Broken sessions count toward total time. You were focused until you weren't. */
  it('includes broken sessions in the total', () => {
    expect(focusStats(history).totalMs).toBe(100 * MINUTE);
  });

  it('is all zeroes for an empty record', () => {
    expect(focusStats([])).toEqual({
      sessions: 0,
      completed: 0,
      broken: 0,
      totalMs: 0,
      longestMs: 0,
      streak: 0,
    });
  });
});

describe('streak — harsh on purpose', () => {
  /**
   * History is newest-first, and a single broken session ends the run. That is
   * stricter than "most of them went fine", deliberately: the number is only
   * worth looking at if it can be lost.
   */
  it('counts consecutive completed sessions from the newest', () => {
    expect(
      focusStats([
        session({ id: '1', outcome: 'completed' }),
        session({ id: '2', outcome: 'completed' }),
        session({ id: '3', outcome: 'broken' }),
        session({ id: '4', outcome: 'completed' }),
      ]).streak
    ).toBe(2);
  });

  it('is zero when the most recent session was broken', () => {
    expect(
      focusStats([
        session({ id: '1', outcome: 'broken' }),
        session({ id: '2', outcome: 'completed' }),
      ]).streak
    ).toBe(0);
  });

  it('counts everything when nothing was ever broken', () => {
    expect(
      focusStats([
        session({ id: '1', outcome: 'completed' }),
        session({ id: '2', outcome: 'completed' }),
      ]).streak
    ).toBe(2);
  });
});

describe('formatDuration', () => {
  it.each([
    [12_000, '12s'],
    [45 * MINUTE, '45m'],
    [60 * MINUTE, '1h 0m'],
    [83 * MINUTE, '1h 23m'],
    [0, '0s'],
  ])('%i ms → %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  /**
   * Seconds appear only under a minute. "1h 23m 07s" invites you to watch the
   * seconds tick, which is the opposite of what a focus timer is for.
   */
  it('drops seconds once there is a minute to report', () => {
    expect(formatDuration(83 * MINUTE + 7000)).toBe('1h 23m');
  });

  it('never renders a negative', () => {
    expect(formatDuration(-5000)).toBe('0s');
  });
});

describe('describeSession', () => {
  it('states a completed session plainly', () => {
    expect(describeSession(session({ outcome: 'completed' }))).toBe('25m focused');
  });

  /** Factual, not scolding. The record is the consequence; tone is not. */
  it('states a broken session without judgement', () => {
    expect(describeSession(session({ outcome: 'broken' }))).toBe('25m, ended early');
  });
});
