/**
 * The focus record, and the rules that protect it.
 *
 * This is the vault. Not notes or credentials — **the session history itself**,
 * because that is the only thing in the app worth protecting from its own user.
 *
 * The protection is asymmetric on purpose:
 *
 *   Reading the record   — always free. It is yours, and the point is that you
 *                          look at it.
 *   Adding to it         — free, but only by living through a session.
 *   Clearing it          — requires the tag. You must physically go to the
 *                          place before you can erase the evidence.
 *
 * A history you can wipe at 11pm from the sofa records nothing. Requiring the
 * walk is the same mechanism as the session itself, applied to the record.
 *
 * Persisted, obviously. A commitment device that forgets on relaunch is a
 * stopwatch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { normaliseTagId, type FocusSession, type SessionOutcome } from '../lib/focus';

export type ActiveSession = {
  tagId: string;
  startedAt: number;
};

export type FocusState = {
  /** The one tag. Bound on first tap, and the reason a stranger's tag is refused. */
  boundTagId: string | null;
  session: ActiveSession | null;
  /** Newest first. Append-only except by `clearHistory`, which needs the tag. */
  history: FocusSession[];
  hasHydrated: boolean;

  bindTag: (tagId: string) => void;
  startSession: (tagId: string) => void;
  /** Ends as promised. Only reachable when the right tag was tapped. */
  endSession: () => void;
  /**
   * The escape hatch.
   *
   * Deliberately available, because a commitment device with no way out is one
   * you uninstall the first time you are genuinely stuck at an airport. The
   * cost is not friction — it is the permanent, visible `broken` mark.
   */
  breakSession: (reason?: string) => void;
  /** Requires the tag. Returns false if the wrong one was presented. */
  clearHistory: (tagId: string) => boolean;
  /** Only for starting over with a different chip. Does not touch history. */
  unbindTag: () => void;
};

const EMPTY = {
  boundTagId: null,
  session: null,
  history: [] as FocusSession[],
};

/** Enough for a local record; not a security boundary. */
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function endWith(state: FocusState, outcome: SessionOutcome, reason?: string): Partial<FocusState> {
  if (!state.session) return {};

  const finished: FocusSession = {
    id: newId(),
    tagId: state.session.tagId,
    startedAt: state.session.startedAt,
    endedAt: Date.now(),
    outcome,
    ...(reason?.trim() ? { reason: reason.trim() } : {}),
  };

  return { session: null, history: [finished, ...state.history] };
}

export const useFocusStore = create<FocusState>()(
  persist(
    (set, get) => ({
      ...EMPTY,
      hasHydrated: false,

      bindTag: (tagId) => set({ boundTagId: normaliseTagId(tagId) }),

      startSession: (tagId) =>
        set({ session: { tagId: normaliseTagId(tagId), startedAt: Date.now() } }),

      endSession: () => set((state) => endWith(state, 'completed')),

      breakSession: (reason) => set((state) => endWith(state, 'broken', reason)),

      clearHistory: (tagId) => {
        const { boundTagId } = get();

        // The same rule as ending a session, applied to the record. Erasing the
        // evidence should cost exactly what earning it did: the walk.
        if (!boundTagId || normaliseTagId(tagId) !== normaliseTagId(boundTagId)) return false;

        set({ history: [] });
        return true;
      },

      unbindTag: () => set({ boundTagId: null }),
    }),
    {
      name: 'tapcard.focus',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,

      // `hasHydrated` is derived, never stored — persisting it would mean
      // reading back `true` before hydration had actually happened.
      partialize: (state) => ({
        boundTagId: state.boundTagId,
        session: state.session,
        history: state.history,
      }),

      /**
       * An in-flight session survives a relaunch, and that is the point: force-
       * quitting the app must not be a way out. The only exits are the tag and
       * the escape hatch, and one of them leaves a mark.
       */
      migrate: (persisted) => {
        const state = persisted as Partial<FocusState> | undefined;
        return {
          boundTagId: state?.boundTagId ?? null,
          session: state?.session ?? null,
          history: state?.history ?? [],
        };
      },

      onRehydrateStorage: () => () => {
        useFocusStore.setState({ hasHydrated: true });
      },
    }
  )
);
