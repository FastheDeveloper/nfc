import { beforeEach, describe, expect, it } from '@jest/globals';

import { useFocusStore } from './focus';

const TAG = '04C4FC91DF2A81';
const OTHER = 'DEADBEEFCAFE01';

beforeEach(() => {
  useFocusStore.setState({ boundTagId: null, session: null, history: [] });
});

const store = () => useFocusStore.getState();

describe('binding the one tag', () => {
  it('remembers it, normalised', () => {
    store().bindTag('04:c4:fc:91:df:2a:81');

    expect(store().boundTagId).toBe(TAG);
  });
});

describe('a session', () => {
  it('records when it started', () => {
    const before = Date.now();
    store().startSession(TAG);

    expect(store().session?.startedAt).toBeGreaterThanOrEqual(before);
    expect(store().session?.tagId).toBe(TAG);
  });

  it('moves to history when completed', () => {
    store().startSession(TAG);
    store().endSession();

    expect(store().session).toBeNull();
    expect(store().history).toHaveLength(1);
    expect(store().history[0].outcome).toBe('completed');
  });

  it('puts the newest first', () => {
    store().startSession(TAG);
    store().endSession();
    store().startSession(TAG);
    store().breakSession();

    expect(store().history.map((s) => s.outcome)).toEqual(['broken', 'completed']);
  });

  it('does nothing when there is no session to end', () => {
    store().endSession();

    expect(store().history).toHaveLength(0);
  });
});

describe('the escape hatch', () => {
  /**
   * Available on purpose — a commitment device with no way out is one you
   * uninstall the first time you are genuinely stuck at an airport.
   */
  it('ends the session', () => {
    store().startSession(TAG);
    store().breakSession();

    expect(store().session).toBeNull();
  });

  /** The cost is not friction. It is the permanent, visible mark. */
  it('marks the session broken', () => {
    store().startSession(TAG);
    store().breakSession();

    expect(store().history[0].outcome).toBe('broken');
  });

  it('keeps a reason when one is given', () => {
    store().startSession(TAG);
    store().breakSession('  left the tag at home  ');

    expect(store().history[0].reason).toBe('left the tag at home');
  });

  it('omits the reason rather than storing an empty one', () => {
    store().startSession(TAG);
    store().breakSession('   ');

    expect(store().history[0].reason).toBeUndefined();
  });
});

describe('the vault rule', () => {
  /**
   * The whole point of making the history the vault. A record you can wipe at
   * 11pm from the sofa records nothing; erasing it should cost exactly what
   * earning it did.
   */
  it('refuses to clear history without the bound tag', () => {
    store().bindTag(TAG);
    store().startSession(TAG);
    store().breakSession();

    expect(store().clearHistory(OTHER)).toBe(false);
    expect(store().history).toHaveLength(1);
  });

  it('clears with the right tag, however it is formatted', () => {
    store().bindTag(TAG);
    store().startSession(TAG);
    store().endSession();

    expect(store().clearHistory('04:c4:fc:91:df:2a:81')).toBe(true);
    expect(store().history).toHaveLength(0);
  });

  it('refuses when no tag is bound at all', () => {
    store().startSession(TAG);
    store().endSession();

    expect(store().clearHistory(TAG)).toBe(false);
    expect(store().history).toHaveLength(1);
  });

  it('unbinding does not erase the record', () => {
    store().bindTag(TAG);
    store().startSession(TAG);
    store().breakSession();
    store().unbindTag();

    expect(store().boundTagId).toBeNull();
    expect(store().history).toHaveLength(1);
  });
});

describe('persistence wiring', () => {
  it('stores under a namespaced key', () => {
    expect(useFocusStore.persist.getOptions().name).toBe('tapcard.focus');
  });

  /**
   * An in-flight session must survive a relaunch. If force-quitting the app
   * ended the session, that would be the real escape hatch — a silent one,
   * with no mark.
   */
  it('persists the running session, not just the history', () => {
    store().bindTag(TAG);
    store().startSession(TAG);

    const persisted = useFocusStore.persist.getOptions().partialize?.(useFocusStore.getState()) as {
      session?: unknown;
    };

    expect(persisted.session).toBeTruthy();
  });

  it('does not persist the hydration flag', () => {
    const persisted = useFocusStore.persist
      .getOptions()
      .partialize?.(useFocusStore.getState()) as Record<string, unknown>;

    expect('hasHydrated' in persisted).toBe(false);
  });
});
