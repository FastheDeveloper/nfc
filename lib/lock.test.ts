import { describe, expect, it } from '@jest/globals';

import { describeStatus, lockGate, lockVerified, NDEF_STATUS } from './lock';

const TAG = '04C4FC91DF2A81';

describe('the gate', () => {
  it('has nothing to confirm before a tag is scanned', () => {
    expect(lockGate(null, null, '')).toEqual({ state: 'no-tag' });
  });

  it('stays unarmed while the typed id is wrong', () => {
    expect(lockGate(TAG, NDEF_STATUS.READ_WRITE, 'DEADBEEF')).toEqual({
      state: 'needs-confirmation',
      expected: TAG,
    });
  });

  it('stays unarmed for a partially typed id', () => {
    expect(lockGate(TAG, NDEF_STATUS.READ_WRITE, '04C4FC').state).toBe('needs-confirmation');
  });

  it('arms only on an exact match', () => {
    expect(lockGate(TAG, NDEF_STATUS.READ_WRITE, TAG)).toEqual({ state: 'armed', tagId: TAG });
  });

  /**
   * The same chip is reported as `04C4FC91DF2A81` by one read path and
   * `04:c4:fc:91:df:2a:81` by another. Someone typing exactly what is on screen
   * must always be right, whichever path produced it.
   */
  it('accepts the id however it is formatted', () => {
    expect(lockGate(TAG, NDEF_STATUS.READ_WRITE, '04:c4:fc:91:df:2a:81').state).toBe('armed');
    expect(lockGate(TAG, NDEF_STATUS.READ_WRITE, '04c4fc91df2a81').state).toBe('armed');
  });

  /**
   * Checked before the typed confirmation, so nobody can type their way into
   * "locking" an already-locked tag and be told it worked. It did not work;
   * there was nothing to do.
   */
  it('reports an already-locked tag regardless of what was typed', () => {
    expect(lockGate(TAG, NDEF_STATUS.READ_ONLY, TAG)).toEqual({ state: 'already-locked' });
    expect(lockGate(TAG, NDEF_STATUS.READ_ONLY, '')).toEqual({ state: 'already-locked' });
  });

  /**
   * `writeLock` is a method on `NFCNDEFTag`. Locking the raw memory of a
   * non-NDEF chip is a different operation against a different interface, so
   * offering it here would be claiming to do something we do not do.
   *
   * This test was originally written asserting 'armed' under a name saying
   * 'refuses' — the name was right and the code was wrong.
   */
  it('refuses a tag that is not NDEF at all, however carefully it was typed', () => {
    expect(lockGate(TAG, NDEF_STATUS.NOT_SUPPORTED, TAG)).toEqual({ state: 'not-lockable' });
    expect(lockGate(TAG, NDEF_STATUS.NOT_SUPPORTED, '')).toEqual({ state: 'not-lockable' });
  });

  it('an empty input never arms, even against an empty-ish id', () => {
    expect(lockGate(TAG, NDEF_STATUS.READ_WRITE, '').state).toBe('needs-confirmation');
    expect(lockGate(TAG, NDEF_STATUS.READ_WRITE, '   ').state).toBe('needs-confirmation');
  });
});

describe('verification', () => {
  /**
   * A lock that reports success and did not happen is worse than a failure:
   * the tag goes into the world believing it is protected, and unlike a failed
   * write you cannot try again to find out.
   */
  it('is only satisfied by a read-only status afterwards', () => {
    expect(lockVerified(NDEF_STATUS.READ_ONLY)).toBe(true);
    expect(lockVerified(NDEF_STATUS.READ_WRITE)).toBe(false);
    expect(lockVerified(NDEF_STATUS.NOT_SUPPORTED)).toBe(false);
    expect(lockVerified(null)).toBe(false);
  });
});

describe('the words', () => {
  it('says permanent, says never, and offers no undo', () => {
    const { LOCK_WARNING } = require('./lock');

    expect(LOCK_WARNING).toContain('permanently');
    expect(LOCK_WARNING).toContain('never');
    expect(LOCK_WARNING).toContain('no undo');
  });

  it('describes a locked tag as permanent rather than merely locked', () => {
    expect(describeStatus(NDEF_STATUS.READ_ONLY)).toContain('permanently');
  });
});
