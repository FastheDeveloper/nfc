import { describe, expect, it } from '@jest/globals';

import { EMPTY_PROFILE, type Profile } from '../store/profile';
import { escapeText, foldLine, splitName, toVCard, utf8ByteLength } from './vcard';

/** The card used throughout Phase 3's size discussion. 200 bytes as text. */
const CARD: Profile = {
  ...EMPTY_PROFILE,
  name: 'Farouq Seriki',
  title: 'Engineer',
  company: 'Recdek, Ltd',
  phone: '+442071234567',
  email: 'fas@example.com',
  url: 'https://example.com',
};

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and newline', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });

  /**
   * Order is load-bearing: escape backslashes last and you escape the ones you
   * just inserted, turning `a,b` into `a\\,b` — a literal backslash followed
   * by an unescaped comma.
   */
  it('escapes backslashes first, not last', () => {
    expect(escapeText(',')).toBe('\\,');
    expect(escapeText('\\')).toBe('\\\\');
    expect(escapeText('\\,')).toBe('\\\\\\,');
  });

  it('normalises all three newline forms to \\n', () => {
    expect(escapeText('a\r\nb')).toBe('a\\nb');
    expect(escapeText('a\rb')).toBe('a\\nb');
    expect(escapeText('a\nb')).toBe('a\\nb');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeText('Farouq Seriki')).toBe('Farouq Seriki');
  });
});

describe('utf8ByteLength', () => {
  it.each([
    ['abc', 3],
    ['é', 2],
    ['日', 3],
    ['😀', 4],
    ['', 0],
  ])('%s is %i bytes', (value, bytes) => {
    expect(utf8ByteLength(value)).toBe(bytes);
    // Cross-checked against Node, so a hand-rolled counter cannot drift.
    expect(utf8ByteLength(value)).toBe(Buffer.byteLength(value, 'utf8'));
  });
});

describe('foldLine', () => {
  it('leaves a short line untouched', () => {
    expect(foldLine('NOTE:hello')).toBe('NOTE:hello');
  });

  it('folds with CRLF followed by a space', () => {
    expect(foldLine(`NOTE:${'a'.repeat(200)}`)).toContain('\r\n ');
  });

  it('keeps every physical line within 75 octets', () => {
    const folded = foldLine(`NOTE:${'a'.repeat(500)}`);

    for (const physical of folded.split('\r\n')) {
      expect(utf8ByteLength(physical)).toBeLessThanOrEqual(75);
    }
  });

  /**
   * The reason this is not `line.slice(0, 75)`. Folding is measured in octets,
   * and splitting a 2-byte character down the middle produces invalid UTF-8 —
   * which survives a naive test but corrupts the value.
   */
  it('never splits a multi-byte character', () => {
    const folded = foldLine(`NOTE:${'é'.repeat(120)}`);

    expect(folded).not.toContain('�');
    expect(Buffer.from(folded, 'utf8').toString('utf8')).toBe(folded);
  });

  it('handles 4-byte characters at the fold boundary', () => {
    const folded = foldLine(`NOTE:${'😀'.repeat(60)}`);

    expect(Buffer.from(folded, 'utf8').toString('utf8')).toBe(folded);
    for (const physical of folded.split('\r\n')) {
      expect(utf8ByteLength(physical)).toBeLessThanOrEqual(75);
    }
  });

  it('unfolds back to the original value', () => {
    const original = `NOTE:${'abcdefghij'.repeat(30)}`;
    // Unfolding is the reader's job: drop CRLF followed by a single space.
    expect(foldLine(original).replace(/\r\n /g, '')).toBe(original);
  });
});

describe('splitName', () => {
  it.each([
    ['Farouq Seriki', { family: 'Seriki', given: 'Farouq' }],
    ['Prince', { family: 'Prince', given: '' }],
    ['Ada Byron Lovelace', { family: 'Lovelace', given: 'Ada Byron' }],
    ['  spaced   out  ', { family: 'out', given: 'spaced' }],
    ['', { family: '', given: '' }],
  ])('splits %s', (input, expected) => {
    expect(splitName(input)).toEqual(expected);
  });
});

describe('toVCard', () => {
  it('opens and closes correctly, with CRLF throughout', () => {
    const vcard = toVCard(CARD);

    expect(vcard.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n')).toBe(true);
    expect(vcard.endsWith('END:VCARD\r\n')).toBe(true);
    // A bare \n is the most common way a hand-written vCard fails to import.
    expect(vcard.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('emits the structured N field vCard 3.0 requires', () => {
    expect(toVCard(CARD)).toContain('N:Seriki;Farouq;;;\r\n');
  });

  it('escapes inside values but not the property separators', () => {
    const vcard = toVCard(CARD);

    expect(vcard).toContain('ORG:Recdek\\, Ltd');
    // The semicolons in N are component separators and must stay literal.
    expect(vcard).toContain('N:Seriki;Farouq;;;');
  });

  it('escapes a semicolon inside a value', () => {
    expect(toVCard({ ...EMPTY_PROFILE, company: 'A;B' })).toContain('ORG:A\\;B');
  });

  it('omits empty fields rather than emitting blank properties', () => {
    const vcard = toVCard({ ...EMPTY_PROFILE, name: 'Ada Lovelace' });

    expect(vcard).toContain('FN:Ada Lovelace');
    expect(vcard).not.toContain('TEL');
    expect(vcard).not.toContain('EMAIL');
    expect(vcard).not.toContain('NOTE');
    expect(vcard).not.toContain('ORG');
  });

  it('omits N too when there is no name at all', () => {
    // Matched as a line start: the plain substring 'N:' also appears inside
    // 'BEGIN:VCARD', which made the first version of this test pass for the
    // wrong reason on any card at all.
    expect(toVCard({ ...EMPTY_PROFILE, email: 'a@b.co' })).not.toMatch(/^N:/m);
    expect(toVCard({ ...EMPTY_PROFILE, name: 'Ada Lovelace' })).toMatch(/^N:/m);
  });

  it('produces a valid card from an entirely empty profile', () => {
    expect(toVCard(EMPTY_PROFILE)).toBe('BEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD\r\n');
  });

  it('flattens a multi-line note into an escaped single line', () => {
    const vcard = toVCard({ ...EMPTY_PROFILE, note: 'line one\nline two' });

    expect(vcard).toContain('NOTE:line one\\nline two');
  });

  /**
   * The number Phase 3's whole capacity story rests on. Pinned so that a change
   * to the encoder cannot quietly move it — if this fails, the capacity
   * warnings and the article's figures need revisiting together.
   */
  it('is 200 bytes for a realistic card', () => {
    expect(Buffer.byteLength(toVCard(CARD), 'utf8')).toBe(200);
  });
});
