/**
 * vCard 3.0 encoding.
 *
 * vCard is a 1990s line-based format and it shows: values are escaped with
 * backslashes, structured fields are semicolon-delimited, lines must end CRLF,
 * and long lines are folded by inserting a line break followed by a space.
 * Every one of those rules is a place to get it subtly wrong in a way that no
 * parser complains about — it just shows the user a contact called
 * `Seriki\, Farouq`.
 *
 * Why vCard at all, when a URL record is a tenth the size? Because it is
 * **self-contained**. A URL needs something at the other end: a server, a
 * domain that stays renewed, a network connection at the moment someone taps.
 * A vCard on the tag is the whole card. That is the trade this phase puts in
 * front of the user rather than deciding for them.
 *
 * vCard **3.0** rather than 4.0 deliberately. 4.0 is cleaner, but iOS and
 * Android contact importers both handle 3.0 without complaint and 3.0 is what
 * `text/vcard` overwhelmingly means in the wild. Interoperability beats
 * tidiness for a format whose entire job is being read by someone else's app.
 *
 * Pure: no react-native imports, so it tests in plain Node.
 */

import type { Profile } from '../store/profile';

/** RFC 2426 says SHOULD fold at 75 octets, excluding the line break. */
const FOLD_AT = 75;

/**
 * Escape a text value.
 *
 * Order matters: backslash first, or we would escape the backslashes we are
 * about to insert. Real newlines become the two-character sequence `\n`,
 * because a literal line break inside a value would be read as the start of a
 * new property.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/** UTF-8 length in bytes. What the tag actually stores, not `String.length`. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;

  for (const char of value) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp < 0x80) bytes += 1;
    else if (cp < 0x800) bytes += 2;
    else if (cp < 0x10000) bytes += 3;
    else bytes += 4;
  }

  return bytes;
}

/**
 * Fold a long line.
 *
 * The folding rule is measured in **octets, not characters**, and a fold must
 * never land in the middle of a multi-byte UTF-8 sequence — split `é` down the
 * middle and the line is no longer valid UTF-8. So this walks by code point
 * and tracks the byte cost as it goes, rather than the obvious
 * `line.slice(0, 75)`, which is wrong the moment a name is not ASCII.
 *
 * Folding costs three bytes per fold (CRLF plus the leading space) on a tag
 * with roughly 144 of them. It is still done, because unfolded long lines are
 * out of spec and this file's whole purpose is being parsed by software we do
 * not control.
 */
export function foldLine(line: string): string {
  if (utf8ByteLength(line) <= FOLD_AT) return line;

  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  // Continuation lines start with a space, which counts toward their budget.
  let limit = FOLD_AT;

  for (const char of line) {
    const size = utf8ByteLength(char);

    if (currentBytes + size > limit) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
      limit = FOLD_AT - 1;
    }

    current += char;
    currentBytes += size;
  }

  if (current) chunks.push(current);

  return chunks.join('\r\n ');
}

/**
 * Split a display name into vCard's structured `N` field.
 *
 * `N` is `Family;Given;Additional;Prefix;Suffix` and vCard 3.0 requires it, so
 * we cannot simply omit it and rely on `FN`.
 *
 * This is a **heuristic and cannot be otherwise**: "last token is the family
 * name" is wrong for much of the world — Chinese and Hungarian names put the
 * family name first, Spanish names often carry two, and plenty of people have
 * one name. We take the last whitespace-separated token as the family name
 * because it is right for the common case, and `FN` — the formatted name,
 * which is what every importer actually displays — always carries the name
 * exactly as it was typed.
 */
export function splitName(full: string): { family: string; given: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return { family: '', given: '' };
  if (parts.length === 1) return { family: parts[0], given: '' };

  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') };
}

/** One `PROPERTY:value` line, escaped and folded. Empty values are dropped. */
function line(property: string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  return foldLine(`${property}:${escapeText(trimmed)}`);
}

/**
 * Encode a profile as a vCard 3.0 document.
 *
 * Empty fields are omitted entirely rather than written as `TEL:` with nothing
 * after it. Blank properties are legal and some importers will happily create
 * an empty phone number from one — and on a 144-byte tag, four unused
 * properties is a tenth of the budget spent on nothing.
 */
export function toVCard(profile: Profile): string {
  const { family, given } = splitName(profile.name);

  const lines: (string | null)[] = [
    'BEGIN:VCARD',
    'VERSION:3.0',

    // N is required by 3.0. Its five components are semicolon-separated, so
    // each component is escaped individually — a semicolon inside a name must
    // not read as a component break.
    profile.name.trim() ? foldLine(`N:${escapeText(family)};${escapeText(given)};;;`) : null,

    line('FN', profile.name),
    line('ORG', profile.company),
    line('TITLE', profile.title),
    line('TEL;TYPE=CELL', profile.phone),
    line('EMAIL;TYPE=INTERNET', profile.email),
    line('URL', profile.url),
    line('NOTE', profile.note),

    'END:VCARD',
  ];

  // CRLF throughout — RFC 2425 requires it, and a bare \n is the single most
  // common way a hand-written vCard fails to import.
  return lines.filter((l): l is string => l !== null).join('\r\n') + '\r\n';
}
