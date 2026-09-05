/**
 * The last tag we read.
 *
 * Phase 2 splits reading across two screens: the Read tab scans and shows a
 * one-line summary, and `/tag` shows everything. Something has to hold the tag
 * between them, and route params are the wrong tool — an NDEF payload is an
 * array of bytes, and serialising it through a URL would mean encoding and
 * re-parsing binary data for no reason.
 *
 * So: a store. Zustand has been a dependency since the Phase 0 scaffold and
 * this is its first real use.
 *
 * Records are decoded **once**, here, at the moment the tag arrives — not in a
 * selector. A selector that called `decodeMessage` would return a fresh array
 * on every render, which is a new object identity every time, which re-renders
 * every consumer forever. Decoding on write is both cheaper and correct.
 *
 * Deliberately **not** persisted. Scan history is a nice-to-have (N4) that
 * overlaps Phase 3's storage work; keeping this in memory means a relaunch
 * starts clean, which is also what you want while testing on a device.
 */

import { create } from 'zustand';

import { decodeMessage, type NdefView } from '../lib/ndef';
import type { RawTag } from '../lib/tagFacts';

export type TagState = {
  /** The raw tag exactly as the native side handed it over. */
  tag: RawTag | null;
  /** Its records, decoded once on write. */
  views: NdefView[];
  /** `Date.now()` at the moment of the read, or null if there has been none. */
  scannedAt: number | null;

  /** Record a successful read. Passing `null` clears, same as `clear()`. */
  setTag: (tag: RawTag | null) => void;
  clear: () => void;
};

const EMPTY: Pick<TagState, 'tag' | 'views' | 'scannedAt'> = {
  tag: null,
  views: [],
  scannedAt: null,
};

export const useTagStore = create<TagState>((set) => ({
  ...EMPTY,

  setTag: (tag) =>
    set(tag ? { tag, views: decodeMessage(tag.ndefMessage), scannedAt: Date.now() } : { ...EMPTY }),

  clear: () => set({ ...EMPTY }),
}));

/**
 * Has anything been scanned yet?
 *
 * `/tag` can be reached with an empty store — a deep link, or a fast refresh
 * during development — and needs to say so rather than render a page of blanks.
 */
export function hasTag(state: TagState): boolean {
  return state.tag !== null;
}
