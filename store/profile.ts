/**
 * The card itself.
 *
 * This is the first thing in the project that has to **survive a relaunch** —
 * every tag we have read so far was disposable, but a profile the user typed
 * is not. AsyncStorage has been a dependency since the Phase 0 scaffold and,
 * like Zustand before it, this is its first real use.
 *
 * Zustand's `persist` middleware is doing the work rather than hand-rolled
 * `AsyncStorage.getItem` calls in a `useEffect`, because the hand-rolled
 * version has to solve rehydration, write coalescing and versioned migration
 * eventually anyway.
 *
 * Note `hasHydrated`. Reading from AsyncStorage is asynchronous, so on the
 * first frame the store legitimately holds the empty defaults — and a form
 * that renders those defaults before hydration finishes will happily save them
 * back over the real profile the moment the user touches a field. The flag is
 * not a loading spinner; it is a correctness guard.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The fields a business card actually carries.
 *
 * Deliberately flat and small. Every field costs bytes on a tag with roughly
 * 144 of them (see `lib/capacity.ts`), so this is not the place for a general
 * contact model — no addresses, no multiple numbers, no photo.
 */
export type Profile = {
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  /** The user's own link. There is no backend; this is whatever they type. */
  url: string;
  note: string;
};

export const EMPTY_PROFILE: Profile = {
  name: '',
  title: '',
  company: '',
  phone: '',
  email: '',
  url: '',
  note: '',
};

export type ProfileState = {
  profile: Profile;
  hasHydrated: boolean;

  /** Update one field. The editor saves as you type; there is no Save button. */
  setField: <K extends keyof Profile>(key: K, value: Profile[K]) => void;
  reset: () => void;
};

/** Bump when the shape changes; `migrate` below decides what to do about it. */
const STORAGE_VERSION = 1;

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      profile: EMPTY_PROFILE,
      hasHydrated: false,

      setField: (key, value) => set((state) => ({ profile: { ...state.profile, [key]: value } })),

      reset: () => set({ profile: EMPTY_PROFILE }),
    }),
    {
      name: 'tapcard.profile',
      storage: createJSONStorage(() => AsyncStorage),
      version: STORAGE_VERSION,

      // `hasHydrated` is derived state, not stored state — persisting it would
      // mean reading back `true` before hydration had actually happened.
      partialize: (state) => ({ profile: state.profile }),

      /**
       * Anything written by an older version is merged over the current
       * defaults, so a field added later arrives as `''` rather than
       * `undefined` and the form never sees a hole. There is only one version
       * so far; this exists so the first migration is not also the first time
       * anyone thinks about migrations.
       */
      migrate: (persisted) => {
        const state = persisted as { profile?: Partial<Profile> } | undefined;
        return { profile: { ...EMPTY_PROFILE, ...(state?.profile ?? {}) } };
      },

      onRehydrateStorage: () => (state) => {
        useProfileStore.setState({ hasHydrated: true });
        void state;
      },
    }
  )
);

/** Is there enough here to be worth writing to a tag? */
export function isProfileEmpty(profile: Profile): boolean {
  return Object.values(profile).every((value) => value.trim() === '');
}

/** The label to show for a profile — falls back through the useful fields. */
export function profileDisplayName(profile: Profile): string {
  return profile.name.trim() || profile.company.trim() || profile.email.trim() || 'Unnamed card';
}
