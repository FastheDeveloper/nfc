import { describe, expect, it } from '@jest/globals';

import { formatUid, tagFacts, type RawTag } from './tagFacts';

/**
 * The iOS fixture is real: this is verbatim what iPhone "Fas" returned from a
 * blank NTAG213 on 2026-09-05 (DEVLOG §1.12). Two fields, nothing else.
 */
const IOS_BLANK_NTAG213: RawTag = { id: '04C4FC91DF2A81', tech: 'mifare' };

/**
 * The Android fixture is **constructed, not observed** — no Android device has
 * been available since the identifier rename. It encodes what the Android API
 * documents it returns, and exists to test our rendering logic, not to make a
 * claim about hardware. PLATFORM-NOTES stays ⏳ until a real device confirms it.
 */
const ANDROID_SHAPED: RawTag = {
  id: '04C4FC91DF2A81',
  techTypes: ['android.nfc.tech.Ndef', 'android.nfc.tech.MifareUltralight'],
  type: 'NFC Forum Type 2',
  maxSize: 144,
  isWritable: true,
};

const factFor = (tag: RawTag, os: 'ios' | 'android', label: string) =>
  tagFacts(tag, os).find((f) => f.label === label);

describe('formatUid', () => {
  it('groups a UID into bytes', () => {
    expect(formatUid('04C4FC91DF2A81')).toBe('04:C4:FC:91:DF:2A:81');
  });

  it('upper-cases and ignores separators already present', () => {
    expect(formatUid('04:c4:fc')).toBe('04:C4:FC');
  });

  it('returns null when there is no UID', () => {
    expect(formatUid(undefined)).toBeNull();
    expect(formatUid('')).toBeNull();
  });
});

describe('tagFacts — no tag', () => {
  it('returns no rows', () => {
    expect(tagFacts(null, 'ios')).toEqual([]);
  });
});

describe('tagFacts — the real iOS blank NTAG213', () => {
  it('renders the UID it did report', () => {
    expect(factFor(IOS_BLANK_NTAG213, 'ios', 'Identifier')?.value).toBe('04:C4:FC:91:DF:2A:81');
  });

  it('renders the single iOS family string, not a technology list', () => {
    expect(factFor(IOS_BLANK_NTAG213, 'ios', 'Technology')?.value).toBe('mifare');
  });

  it('counts zero records for a blank formatted tag', () => {
    expect(factFor(IOS_BLANK_NTAG213, 'ios', 'Records')?.value).toBe('0');
  });

  it('keeps the capacity row and explains the absence rather than blanking it', () => {
    const capacity = factFor(IOS_BLANK_NTAG213, 'ios', 'Capacity');

    expect(capacity?.value).toBeNull();
    expect(capacity?.unavailable).toBe('CoreNFC does not expose tag capacity.');
    expect(capacity?.footnote).toContain('Phase 4');
  });

  it('omits the writable row entirely rather than guessing', () => {
    expect(factFor(IOS_BLANK_NTAG213, 'ios', 'Writable')).toBeUndefined();
  });
});

describe('tagFacts — Android-shaped input (constructed, pending hardware)', () => {
  it('lists every reported technology', () => {
    expect(factFor(ANDROID_SHAPED, 'android', 'Technology')?.value).toBe(
      'android.nfc.tech.Ndef, android.nfc.tech.MifareUltralight'
    );
  });

  it('renders a real capacity with no excuse attached', () => {
    const capacity = factFor(ANDROID_SHAPED, 'android', 'Capacity');

    expect(capacity?.value).toBe('144 bytes');
    expect(capacity?.unavailable).toBeUndefined();
  });

  it('shows the writable row when the platform reports it', () => {
    expect(factFor(ANDROID_SHAPED, 'android', 'Writable')?.value).toBe('Yes');
  });
});

describe('the asymmetry, side by side', () => {
  /**
   * The point of the whole module, as one assertion: the same physical chip
   * yields a number on one platform and an explanation on the other.
   */
  it('same chip, different answer to "how big is it?"', () => {
    expect(factFor(ANDROID_SHAPED, 'android', 'Capacity')?.value).toBe('144 bytes');
    expect(factFor(IOS_BLANK_NTAG213, 'ios', 'Capacity')?.value).toBeNull();
  });

  it('every row is either a value or an explanation — never silently blank', () => {
    for (const os of ['ios', 'android'] as const) {
      const tag = os === 'ios' ? IOS_BLANK_NTAG213 : ANDROID_SHAPED;

      for (const fact of tagFacts(tag, os)) {
        expect(fact.value ?? fact.unavailable).toBeTruthy();
      }
    }
  });
});
