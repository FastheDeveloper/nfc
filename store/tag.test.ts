import { beforeEach, describe, expect, it } from '@jest/globals';

import type { RawTag } from '../lib/tagFacts';
import { hasTag, useTagStore } from './tag';

const utf8 = (s: string): number[] => Array.from(Buffer.from(s, 'utf8'));

/** The real blank NTAG213 from iPhone "Fas" — note the absent `ndefMessage`. */
const IOS_BLANK: RawTag = { id: '04C4FC91DF2A81', tech: 'mifare' };

const WITH_URL: RawTag = {
  id: '04C4FC91DF2A81',
  ndefMessage: [
    { tnf: 1, type: [0x55], payload: [0x04, ...utf8('example.com')] },
  ] as unknown as RawTag['ndefMessage'],
};

beforeEach(() => {
  useTagStore.getState().clear();
  useTagStore.getState().clearHistory();
});

describe('initial state', () => {
  it('starts empty', () => {
    const state = useTagStore.getState();

    expect(state.tag).toBeNull();
    expect(state.views).toEqual([]);
    expect(state.scannedAt).toBeNull();
    expect(hasTag(state)).toBe(false);
  });
});

describe('setTag', () => {
  it('decodes records once, on write', () => {
    useTagStore.getState().setTag(WITH_URL);

    expect(useTagStore.getState().views).toEqual([{ kind: 'uri', uri: 'https://example.com' }]);
  });

  it('keeps the raw tag alongside the decoded view', () => {
    useTagStore.getState().setTag(WITH_URL);

    expect(useTagStore.getState().tag).toBe(WITH_URL);
  });

  it('handles a tag with no ndefMessage key at all', () => {
    // The exact shape iOS returned for a blank formatted tag (DEVLOG §1.12).
    useTagStore.getState().setTag(IOS_BLANK);

    const state = useTagStore.getState();
    expect(state.views).toEqual([]);
    expect(hasTag(state)).toBe(true);
  });

  it('stamps the scan time', () => {
    const before = Date.now();
    useTagStore.getState().setTag(IOS_BLANK);

    expect(useTagStore.getState().scannedAt).toBeGreaterThanOrEqual(before);
  });

  it('replaces the previous tag rather than accumulating', () => {
    useTagStore.getState().setTag(WITH_URL);
    useTagStore.getState().setTag(IOS_BLANK);

    expect(useTagStore.getState().views).toEqual([]);
  });

  it('treats setTag(null) as a clear', () => {
    useTagStore.getState().setTag(WITH_URL);
    useTagStore.getState().setTag(null);

    expect(useTagStore.getState()).toMatchObject({ tag: null, views: [], scannedAt: null });
  });
});

describe('view identity', () => {
  /**
   * The reason decoding happens on write and not in a selector: consumers must
   * be able to rely on `views` being the same array between renders, or every
   * render invalidates every memo downstream.
   */
  it('returns a stable reference until the next scan', () => {
    useTagStore.getState().setTag(WITH_URL);

    const first = useTagStore.getState().views;
    const second = useTagStore.getState().views;

    expect(first).toBe(second);
  });
});

describe('clear', () => {
  it('resets everything', () => {
    useTagStore.getState().setTag(WITH_URL);
    useTagStore.getState().clear();

    const state = useTagStore.getState();
    expect(state.tag).toBeNull();
    expect(state.views).toEqual([]);
    expect(state.scannedAt).toBeNull();
    expect(hasTag(state)).toBe(false);
  });
});

describe('history (N4)', () => {
  it('records each scan, newest first', () => {
    useTagStore.getState().setTag(WITH_URL);
    useTagStore.getState().setTag(IOS_BLANK);

    const summaries = useTagStore.getState().history.map((h) => h.summary);
    expect(summaries).toEqual(['Empty tag — no NDEF records', 'https://example.com']);
  });

  it('stores a summary line, not the whole tag', () => {
    useTagStore.getState().setTag(WITH_URL);

    const [entry] = useTagStore.getState().history;
    expect(Object.keys(entry).sort()).toEqual(['at', 'id', 'summary']);
  });

  it('caps at five entries', () => {
    for (let i = 0; i < 8; i += 1) useTagStore.getState().setTag(IOS_BLANK);

    expect(useTagStore.getState().history).toHaveLength(5);
  });

  it('survives clear(), which only drops the current tag', () => {
    useTagStore.getState().setTag(WITH_URL);
    useTagStore.getState().clear();

    expect(useTagStore.getState().tag).toBeNull();
    expect(useTagStore.getState().history).toHaveLength(1);
  });

  it('is emptied only by clearHistory()', () => {
    useTagStore.getState().setTag(WITH_URL);
    useTagStore.getState().clearHistory();

    expect(useTagStore.getState().history).toEqual([]);
  });

  it('is not touched by setTag(null)', () => {
    useTagStore.getState().setTag(WITH_URL);
    useTagStore.getState().setTag(null);

    expect(useTagStore.getState().history).toHaveLength(1);
  });
});
