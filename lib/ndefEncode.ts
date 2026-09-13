/**
 * Building NDEF messages — the counterpart to the Phase 2 decoder.
 *
 * Phase 2 took bytes off a tag and made them readable. This puts them back,
 * and the interesting part is that the two must agree exactly: T3 encodes a
 * value, decodes it with `lib/ndef.ts`, and asserts it comes back identical.
 * A decoder and an encoder that disagree is the classic way to write a tag
 * only your own app can read.
 *
 * Pure — no react-native imports, testable in plain Node.
 */

import { RTD, TNF, URI_PREFIXES, utf8ToBytes } from './ndef';
import type { NdefRecord } from './nfcTypes';

/**
 * Choose the URI prefix that saves the most bytes.
 *
 * The naive version takes the *first* matching entry, and gets
 * `https://www.example.com` wrong: index 0x04 (`https://`) matches, but 0x02
 * (`https://www.`) matches too and saves four more bytes. So: longest match
 * wins, and index 0 (the empty prefix) is skipped because it matches
 * everything and saves nothing.
 *
 * Returns the index and the remainder to store after it.
 */
export function compressUri(uri: string): { index: number; rest: string } {
  let bestIndex = 0;
  let bestLength = 0;

  for (let i = 1; i < URI_PREFIXES.length; i += 1) {
    const prefix = URI_PREFIXES[i];

    if (prefix.length > bestLength && uri.startsWith(prefix)) {
      bestIndex = i;
      bestLength = prefix.length;
    }
  }

  return { index: bestIndex, rest: uri.slice(bestLength) };
}

/** A URI record: well-known type `U`, payload prefixed by the table index. */
export function uriRecord(uri: string): NdefRecord {
  const { index, rest } = compressUri(uri);

  return {
    tnf: TNF.WELL_KNOWN,
    type: utf8ToBytes(RTD.URI),
    payload: [index, ...utf8ToBytes(rest)],
  } as NdefRecord;
}

/** A MIME media record — `text/vcard` for our purposes. */
export function mimeRecord(mime: string, body: string): NdefRecord {
  return {
    tnf: TNF.MIME_MEDIA,
    type: utf8ToBytes(mime),
    payload: utf8ToBytes(body),
  } as NdefRecord;
}

/** A well-known Text record, for completeness and for round-trip testing. */
export function textRecord(text: string, lang = 'en'): NdefRecord {
  const langBytes = utf8ToBytes(lang);

  return {
    tnf: TNF.WELL_KNOWN,
    type: utf8ToBytes(RTD.TEXT),
    // Status byte: high bit clear = UTF-8, low six bits = language length.
    payload: [langBytes.length & 0x3f, ...langBytes, ...utf8ToBytes(text)],
  } as NdefRecord;
}

/**
 * Serialise one record.
 *
 * The header byte packs five flags and the TNF:
 *
 *     bit 7  MB  Message Begin      — first record in the message
 *     bit 6  ME  Message End        — last record in the message
 *     bit 5  CF  Chunk Flag         — always 0 here; we never chunk
 *     bit 4  SR  Short Record       — payload length fits in one byte
 *     bit 3  IL  ID Length present  — always 0 here; we write no IDs
 *     bits 2-0   TNF
 *
 * `SR` is the one that matters for size. With it set, the payload length is a
 * single byte; without it, four. On a 144-byte tag those three saved bytes are
 * two percent of the budget, so a short record is used whenever the payload
 * is under 256 bytes — which, for anything that fits on an NTAG213, is always.
 */
function encodeRecord(record: NdefRecord, isFirst: boolean, isLast: boolean): number[] {
  const type = Array.isArray(record.type) ? record.type.map(Number) : utf8ToBytes(record.type);
  const payload = (record.payload as number[] | undefined)?.map(Number) ?? [];

  const short = payload.length < 0xff;

  let header = Number(record.tnf) & 0x07;
  if (isFirst) header |= 0x80; // MB
  if (isLast) header |= 0x40; // ME
  if (short) header |= 0x10; // SR

  const lengthBytes = short
    ? [payload.length & 0xff]
    : [
        (payload.length >>> 24) & 0xff,
        (payload.length >>> 16) & 0xff,
        (payload.length >>> 8) & 0xff,
        payload.length & 0xff,
      ];

  return [header, type.length & 0xff, ...lengthBytes, ...type, ...payload];
}

/**
 * Serialise a whole message.
 *
 * An empty message is a single empty record rather than zero bytes — that is
 * how NDEF spells "this tag is formatted and deliberately blank", and it is
 * what a factory-fresh NTAG213 carries.
 */
export function encodeMessage(records: readonly NdefRecord[]): number[] {
  if (!records.length) {
    return encodeRecord({ tnf: TNF.EMPTY, type: [], payload: [] } as NdefRecord, true, true);
  }

  return records.flatMap((record, i) => encodeRecord(record, i === 0, i === records.length - 1));
}

/**
 * How many bytes this message occupies — the number the capacity check needs.
 *
 * Note what this does *not* include: the tag stores the message inside a TLV
 * wrapper, so real usage is a few bytes higher. `lib/capacity.ts` accounts for
 * that; keeping it out of here means this function answers exactly one
 * question.
 */
export function encodedSize(records: readonly NdefRecord[]): number {
  return encodeMessage(records).length;
}
