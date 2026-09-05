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

import { decodeMessage, summarise, type NdefView } from '../lib/ndef';
import type { RawTag } from '../lib/tagFacts';

/** How many recent scans to remember. Small on purpose — see below. */
const HISTORY_LIMIT = 5;

/** One line of scan history. Deliberately a summary, not a whole tag. */
export type ScanRecord = {
  id: string | undefined;
  summary: string;
  at: number;
};

export type TagState = {
  /** The raw tag exactly as the native side handed it over. */
  tag: RawTag | null;
  /** Its records, decoded once on write. */
  views: NdefView[];
  /** `Date.now()` at the moment of the read, or null if there has been none. */
  scannedAt: number | null;

  /**
   * The last few scans, newest first (N4).
   *
   * In memory only. Persisting this would mean choosing a storage shape now,
   * and Phase 3 has to design storage for the user's profile anyway — two
   * persistence patterns landing a week apart is how codebases end up with
   * two. It also means a relaunch starts clean, which is what you want while
   * testing on a device.
   *
   * Stores a *summary line*, not the tag: history is for orientation ("did I
   * already scan this one?"), and keeping five full tag objects with their
   * byte arrays alive for that would be a poor trade.
   */
  history: ScanRecord[];

  /** Record a successful read. Passing `null` clears, same as `clear()`. */
  setTag: (tag: RawTag | null) => void;
  /** Clear the current tag. Leaves history alone. */
  clear: () => void;
  clearHistory: () => void;
};

const EMPTY: Pick<TagState, 'tag' | 'views' | 'scannedAt'> = {
  tag: null,
  views: [],
  scannedAt: null,
};

export const useTagStore = create<TagState>((set) => ({
  ...EMPTY,
  history: [],

  setTag: (tag) =>
    set((state) => {
      if (!tag) return { ...EMPTY };

      const views = decodeMessage(tag.ndefMessage);
      const at = Date.now();

      return {
        tag,
        views,
        scannedAt: at,
        history: [{ id: tag.id, summary: summarise(views), at }, ...state.history].slice(
          0,
          HISTORY_LIMIT
        ),
      };
    }),

  /** Clears the current tag. History survives — see `clearHistory`. */
  clear: () => set({ ...EMPTY }),

  clearHistory: () => set({ history: [] }),
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
