import { describe, expect, it } from '@jest/globals';

import { EMPTY_PROFILE, type Profile } from '../store/profile';
import {
  assessCapacity,
  capacityCaveat,
  capacityDetail,
  capacityTitle,
  NTAG213_NDEF_BYTES,
  tlvOverhead,
} from './capacity';
import { mimeRecord, uriRecord } from './ndefEncode';
import { toVCard } from './vcard';

const CARD: Profile = {
  ...EMPTY_PROFILE,
  name: 'Farouq Seriki',
  title: 'Engineer',
  company: 'Recdek, Ltd',
  phone: '+442071234567',
  email: 'fas@example.com',
  url: 'https://example.com',
};

const URL_RECORDS = [uriRecord('https://example.com/fas')];
const VCARD_RECORDS = [mimeRecord('text/vcard', toVCard(CARD))];

/**
 * A message of an exact size, for testing the thresholds.
 *
 * `mimeRecord('t', body)` costs 4 bytes of framing — header, type length,
 * payload length, and the one-character type — plus the body.
 */
const atMessageBytes = (bytes: number) =>
  assessCapacity([mimeRecord('t', 'x'.repeat(Math.max(bytes - 4, 0)))]);

describe('tlvOverhead', () => {
  it('is 3 bytes for a short message: tag, one length byte, terminator', () => {
    expect(tlvOverhead(20)).toBe(3);
    expect(tlvOverhead(254)).toBe(3);
  });

  it('grows to 5 once the length needs 16 bits', () => {
    expect(tlvOverhead(255)).toBe(5);
    expect(tlvOverhead(1000)).toBe(5);
  });
});

describe('the assumed budget is a measured figure', () => {
  /**
   * 137 is what a real NTAG213 reported through `queryNDEFStatus` on
   * 2026-09-05, not a number read off a datasheet. The chip's raw user memory
   * is 144; the difference is the tag's own bookkeeping.
   *
   * This test exists because the previous value — 144 — was wrong in a way
   * nothing caught: it was a real number about the chip, just not an answer to
   * the question being asked.
   */
  it('is the maximum NDEF message, not raw user memory', () => {
    expect(NTAG213_NDEF_BYTES).toBe(137);
  });
});

describe('the two payloads, on an assumed NTAG213', () => {
  it('a short URL fits with room to spare', () => {
    expect(assessCapacity(URL_RECORDS)).toMatchObject({
      messageBytes: 20,
      requiredBytes: 20,
      budget: 137,
      basis: 'assumed',
      verdict: 'fits',
      headroom: 117,
    });
  });

  /** The finding that drives the write screen: an ordinary card does not fit. */
  it('a realistic vCard does not fit', () => {
    const capacity = assessCapacity(VCARD_RECORDS);

    expect(capacity.messageBytes).toBe(213);
    expect(capacity.requiredBytes).toBe(213);
    expect(capacity.verdict).toBe('too-big');
    expect(capacity.headroom).toBe(-76);
  });
});

describe('TLV framing is reported but never counted', () => {
  /**
   * The correction. An earlier version added the framing to the message and
   * compared the total against raw user memory — double-counting, because
   * every budget in play is already a maximum *message* size.
   */
  it('is shown for both an assumed and a reported budget', () => {
    expect(assessCapacity(URL_RECORDS).tlvBytes).toBe(3);
    expect(assessCapacity(URL_RECORDS, 137).tlvBytes).toBe(3);
  });

  it('is never added to what we compare', () => {
    for (const capacity of [assessCapacity(URL_RECORDS), assessCapacity(URL_RECORDS, 137)]) {
      expect(capacity.requiredBytes).toBe(capacity.messageBytes);
    }
  });
});

describe('verdict thresholds', () => {
  it('is fits well under budget', () => {
    expect(atMessageBytes(50).verdict).toBe('fits');
  });

  it('is tight within the last ten percent', () => {
    const capacity = atMessageBytes(130);

    expect(capacity.requiredBytes).toBeLessThanOrEqual(NTAG213_NDEF_BYTES);
    expect(capacity.requiredBytes).toBeGreaterThan(NTAG213_NDEF_BYTES * 0.9);
    expect(capacity.verdict).toBe('tight');
  });

  it('exactly at budget still counts as fitting', () => {
    const capacity = atMessageBytes(NTAG213_NDEF_BYTES);

    expect(capacity.headroom).toBe(0);
    expect(capacity.verdict).not.toBe('too-big');
  });

  it('is too-big one byte over', () => {
    expect(atMessageBytes(NTAG213_NDEF_BYTES + 1).verdict).toBe('too-big');
  });
});

describe('a reported budget replaces the assumption', () => {
  it('uses the number the tag gave', () => {
    expect(assessCapacity(URL_RECORDS, 500)).toMatchObject({ budget: 500, basis: 'reported' });
  });

  it('falls back to the assumption for a missing or nonsensical value', () => {
    expect(assessCapacity(URL_RECORDS, undefined).basis).toBe('assumed');
    expect(assessCapacity(URL_RECORDS, 0).basis).toBe('assumed');
    expect(assessCapacity(URL_RECORDS, -1).basis).toBe('assumed');
  });

  /**
   * The real session, reproduced. iPhone "Fas" reported 137 for an NTAG213 and
   * the app refused a 202-byte card before writing anything.
   */
  it('reproduces the observed refusal', () => {
    const observed = assessCapacity(VCARD_RECORDS, 137);

    expect(observed.basis).toBe('reported');
    expect(observed.verdict).toBe('too-big');
    expect(observed.headroom).toBeLessThan(0);
  });

  it('the same card fits on a tag that reports more', () => {
    expect(assessCapacity(VCARD_RECORDS, 504).verdict).toBe('fits');
  });
});

describe('copy', () => {
  it('names the assumption every single time it is assumed', () => {
    expect(capacityDetail(assessCapacity(URL_RECORDS))).toContain('assuming');
    expect(capacityDetail(assessCapacity(VCARD_RECORDS))).toContain('assuming');
  });

  it('drops the word once the tag has answered, and says so', () => {
    const detail = capacityDetail(assessCapacity(URL_RECORDS, 137));

    expect(detail).not.toContain('assuming');
    expect(detail).toContain('this tag reports');
  });

  it('says how far over, not just that it is over', () => {
    expect(capacityDetail(assessCapacity(VCARD_RECORDS))).toContain('76 bytes over');
  });

  it('offers the way out', () => {
    expect(capacityDetail(assessCapacity(VCARD_RECORDS))).toContain('link');
  });

  /**
   * The caveat no longer blames iOS — the platform does report capacity. It
   * explains the real limit: no tag has been near the phone yet.
   */
  it('caveats an assumption without blaming the platform', () => {
    const caveat = capacityCaveat(assessCapacity(URL_RECORDS));

    expect(caveat).toContain('No tag has reported its size yet');
    expect(caveat).not.toContain('iOS does not');
  });

  it('stays silent once the number is measured', () => {
    expect(capacityCaveat(assessCapacity(URL_RECORDS, 137))).toBeNull();
  });

  it('has a distinct title per verdict', () => {
    expect(
      new Set([
        capacityTitle(assessCapacity(URL_RECORDS)),
        capacityTitle(assessCapacity(VCARD_RECORDS)),
      ]).size
    ).toBe(2);
  });
});
