import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  EMPTY_PROFILE,
  isProfileEmpty,
  profileDisplayName,
  useProfileStore,
  type Profile,
} from './profile';

const FILLED: Profile = {
  name: 'Farouq Seriki',
  title: 'Engineer',
  company: 'Recdek',
  phone: '+442071234567',
  email: 'fas@example.com',
  url: 'https://example.com',
  note: '',
};

beforeEach(() => {
  useProfileStore.getState().reset();
});

describe('setField', () => {
  it('updates one field without disturbing the others', () => {
    useProfileStore.getState().setField('name', 'Farouq');
    useProfileStore.getState().setField('email', 'fas@example.com');

    expect(useProfileStore.getState().profile).toEqual({
      ...EMPTY_PROFILE,
      name: 'Farouq',
      email: 'fas@example.com',
    });
  });

  it('reset returns to empty', () => {
    useProfileStore.getState().setField('name', 'Farouq');
    useProfileStore.getState().reset();

    expect(useProfileStore.getState().profile).toEqual(EMPTY_PROFILE);
  });
});

describe('isProfileEmpty', () => {
  it('is true for the defaults', () => {
    expect(isProfileEmpty(EMPTY_PROFILE)).toBe(true);
  });

  it('treats whitespace as empty', () => {
    expect(isProfileEmpty({ ...EMPTY_PROFILE, name: '   ' })).toBe(true);
  });

  it('is false once anything real is set', () => {
    expect(isProfileEmpty({ ...EMPTY_PROFILE, phone: '+44' })).toBe(false);
  });
});

describe('profileDisplayName', () => {
  it('prefers the name', () => {
    expect(profileDisplayName(FILLED)).toBe('Farouq Seriki');
  });

  it('falls back through company, then email', () => {
    expect(profileDisplayName({ ...FILLED, name: '' })).toBe('Recdek');
    expect(profileDisplayName({ ...FILLED, name: '', company: '' })).toBe('fas@example.com');
  });

  it('never returns an empty string', () => {
    expect(profileDisplayName(EMPTY_PROFILE)).toBe('Unnamed card');
  });
});

describe('persistence wiring', () => {
  /**
   * The guard that stops the editor saving its own empty defaults over a real
   * profile before AsyncStorage has answered. Worth a test because the failure
   * mode is silent data loss, and it only shows up on a cold launch.
   */
  it('exposes a hydration flag that is not itself persisted', () => {
    expect(typeof useProfileStore.getState().hasHydrated).toBe('boolean');
    expect(useProfileStore.persist.getOptions().partialize?.(useProfileStore.getState())).toEqual({
      profile: EMPTY_PROFILE,
    });
  });

  it('is stored under a namespaced key', () => {
    expect(useProfileStore.persist.getOptions().name).toBe('tapcard.profile');
  });

  it('migrates unknown-version data onto the current defaults', () => {
    const migrate = useProfileStore.persist.getOptions().migrate;
    const migrated = migrate?.({ profile: { name: 'Old' } }, 0) as { profile: Profile };

    expect(migrated.profile).toEqual({ ...EMPTY_PROFILE, name: 'Old' });
  });

  it('survives a persisted payload missing fields entirely', () => {
    const migrate = useProfileStore.persist.getOptions().migrate;
    const migrated = migrate?.({}, 0) as { profile: Profile };

    expect(migrated.profile).toEqual(EMPTY_PROFILE);
  });
});
