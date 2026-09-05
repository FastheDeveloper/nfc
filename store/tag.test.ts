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
