import { describe, expect, it } from '@jest/globals';

import { guessChip } from './manufacturer';

describe('guessChip', () => {
  it('identifies the real NTAG213 we tested', () => {
    expect(guessChip('04C4FC91DF2A81')).toEqual({
      manufacturer: 'NXP Semiconductors',
      family: 'NTAG21x / MIFARE Ultralight (7-byte UID)',
    });
  });

  it('accepts a formatted UID', () => {
    expect(guessChip('04:C4:FC:91:DF:2A:81')?.manufacturer).toBe('NXP Semiconductors');
  });

  it('reads a 4-byte NXP UID as the older MIFARE Classic shape', () => {
    expect(guessChip('04A1B2C3')?.family).toBe('MIFARE Classic (4-byte UID)');
  });

  it('names other manufacturers without guessing a family', () => {
    expect(guessChip('02A1B2C3D4E5F6')).toEqual({ manufacturer: 'STMicroelectronics' });
  });

  it('returns null rather than "Unknown" for an unrecognised code', () => {
    expect(guessChip('FFA1B2C3')).toBeNull();
  });

  it('returns null for missing or unusable input', () => {
    expect(guessChip(undefined)).toBeNull();
    expect(guessChip('')).toBeNull();
    expect(guessChip('0')).toBeNull();
  });

  /**
   * The limit that matters. A UID says who made the chip; it cannot say how
   * many bytes it holds — an NTAG213 (144 bytes) and an NTAG216 (888 bytes)
   * are indistinguishable here. That is the gap Phase 4 closes.
   */
  it('cannot distinguish NTAG213 from NTAG216', () => {
    const ntag213 = guessChip('04C4FC91DF2A81');
    const ntag216 = guessChip('04112233445566');

    expect(ntag213?.family).toBe(ntag216?.family);
  });
});
