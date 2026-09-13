/**
 * NDEF decoding, hand-rolled.
 *
 * This module imports **nothing from react-native** — only a type, which is
 * erased at compile time. That is deliberate: it makes every function here
 * testable in plain Node with no device, no emulator and no native build,
 * which is the only reason Phase 2 could proceed while no Android phone was
 * available.
 *
 * Why not use the library's bundled `Ndef` helpers? Two of them are wrong, and
 * both bugs are quiet:
 *
 *   1. `ndef-lib/ndef-text.js` reads the language code's *length* and then
 *      discards the language code itself — the extracting line is commented
 *      out — and its UTF-16 handling is an open `TODO`.
 *   2. `ndef-lib/util.js` builds strings with `String.fromCharCode`, which
 *      truncates above U+FFFF, so any 4-byte UTF-8 sequence (emoji and other
 *      astral-plane characters) decodes to the wrong character.
 *
 * Its URI decoder, by contrast, is correct and eight lines long. So the tests
 * assert we *agree* with the library on URIs and *deliberately differ* on text.
 * See DEVLOG §2.
 */

/** Type-only import: erased at compile time, so this module stays RN-free. */
import type { NdefRecord } from './nfcTypes';

/**
 * Type Name Format — the 3-bit field that says how to interpret a record's
 * `type`. NDEF's dispatch starts here, and everything else is conditional
 * on it.
 */
export const TNF = {
  EMPTY: 0x00,
  WELL_KNOWN: 0x01,
  MIME_MEDIA: 0x02,
  ABSOLUTE_URI: 0x03,
  EXTERNAL_TYPE: 0x04,
  UNKNOWN: 0x05,
  UNCHANGED: 0x06,
  RESERVED: 0x07,
} as const;

/** Record Type Definition names, used when TNF is WELL_KNOWN. */
export const RTD = {
  TEXT: 'T',
  URI: 'U',
  SMART_POSTER: 'Sp',
} as const;

/**
 * The status byte of a Text record advertises UTF-8 or UTF-16. It does not say
 * which byte order — a BOM may, so we report what we actually found rather than
 * the spec's default.
 */
export type TextEncodingName = 'utf-8' | 'utf-16be' | 'utf-16le';

/** The Android Application Record's external type name. */
export const AAR_TYPE = 'android.com:pkg';

/**
 * The decoded, render-ready view of one record.
 *
 * A discriminated union rather than a bag of optional fields, so the UI cannot
 * read `uri` off a text record — the compiler refuses. `unknown` always carries
 * enough to render a hex dump, because a reader that silently drops records it
 * does not understand is worse than one that admits it.
 */
export type NdefView =
  | { kind: 'empty' }
  | { kind: 'uri'; uri: string }
  | { kind: 'text'; text: string; lang: string; encoding: TextEncodingName }
  | { kind: 'mime'; mime: string; text?: string; bytes: number[] }
  | { kind: 'aar'; packageName: string }
  | { kind: 'unknown'; tnf: number; type: string; payload: number[] };

/**
 * NFC Forum URI RTD prefix table (URI Record Type Definition, §3.2.2).
 *
 * The single most space-efficient idea in the format: the first payload byte
 * indexes this table, so `https://` costs one byte instead of eight. On a tag
 * with ~144 usable bytes that is not a micro-optimisation.
 *
 * Indices 0x00–0x23 are defined; 0x24–0xFF are reserved and MUST be treated as
 * no prefix rather than as an error.
 */
export const URI_PREFIXES: readonly string[] = [
  '', // 0x00
  'http://www.', // 0x01
  'https://www.', // 0x02
  'http://', // 0x03
  'https://', // 0x04
  'tel:', // 0x05
  'mailto:', // 0x06
  'ftp://anonymous:anonymous@', // 0x07
  'ftp://ftp.', // 0x08
  'ftps://', // 0x09
  'sftp://', // 0x0a
  'smb://', // 0x0b
  'nfs://', // 0x0c
  'ftp://', // 0x0d
  'dav://', // 0x0e
  'news:', // 0x0f
  'telnet://', // 0x10
  'imap:', // 0x11
  'rtsp://', // 0x12
  'urn:', // 0x13
  'pop:', // 0x14
  'sip:', // 0x15
  'sips:', // 0x16
  'tftp:', // 0x17
  'btspp://', // 0x18
  'btl2cap://', // 0x19
  'btgoep://', // 0x1a
  'tcpobex://', // 0x1b
  'irdaobex://', // 0x1c
  'file://', // 0x1d
  'urn:epc:id:', // 0x1e
  'urn:epc:tag:', // 0x1f
  'urn:epc:pat:', // 0x20
  'urn:epc:raw:', // 0x21
  'urn:epc:', // 0x22
  'urn:nfc:', // 0x23
];

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

/** Lower-case hex, space-separated. `[]` renders as `(empty)`. */
export function bytesToHex(bytes: readonly number[] | undefined): string {
  if (!bytes?.length) return '(empty)';
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join(' ');
}

/**
 * Decode UTF-8 bytes.
 *
 * Hand-rolled rather than using `TextDecoder`, which Hermes does not guarantee,
 * and rather than the library's version, which truncates above U+FFFF.
 * `String.fromCodePoint` is the fix — it emits the surrogate pair that
 * `fromCharCode` cannot.
 *
 * Invalid sequences degrade to U+FFFD rather than throwing. A malformed byte in
 * the middle of a tag should cost you one character, not the whole read.
 */
export function bytesToUtf8(bytes: readonly number[]): string {
  let out = '';

  for (let i = 0; i < bytes.length;) {
    const b0 = bytes[i] & 0xff;

    // 0xxxxxxx — plain ASCII, the overwhelmingly common case.
    if (b0 < 0x80) {
      out += String.fromCodePoint(b0);
      i += 1;
      continue;
    }

    // How many continuation bytes does this leading byte promise?
    let needed: number;
    let cp: number;
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      needed = 1;
      cp = b0 & 0x1f;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      needed = 2;
      cp = b0 & 0x0f;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      needed = 3;
      cp = b0 & 0x07;
    } else {
      // A continuation byte with no leader, or an over-long form.
      out += '�';
      i += 1;
      continue;
    }

    // Truncated: the leading byte promises continuation bytes that are not there.
    if (i + needed > bytes.length - 1) {
      out += '�';
      i += 1;
      continue;
    }

    let valid = true;
    for (let k = 1; k <= needed; k += 1) {
      const bx = bytes[i + k] & 0xff;
      if ((bx & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      cp = (cp << 6) | (bx & 0x3f);
    }

    if (!valid || cp > 0x10ffff) {
      out += '�';
      i += 1;
      continue;
    }

    out += String.fromCodePoint(cp);
    i += needed + 1;
  }

  return out;
}

/**
 * A record's `type` field arrives as bytes on Android and, sometimes, as an
 * already-decoded string on iOS. Normalise before comparing to `RTD.URI` and
 * friends — the platform difference is real and easy to miss, because a
 * `number[]` never equals `'U'` and the comparison just quietly fails.
 */
export function typeToString(type: NdefRecord['type'] | undefined): string {
  if (type == null) return '';
  if (typeof type === 'string') return type;
  return bytesToUtf8(type);
}

// ---------------------------------------------------------------------------
// URI records
// ---------------------------------------------------------------------------

/**
 * Decode a URI record payload.
 *
 * Layout (NFC Forum URI RTD):
 *
 *     04 65 78 61 6d 70 6c 65 2e 63 6f 6d
 *     │  └──────── "example.com" ────────┘
 *     └─ prefix index → URI_PREFIXES[0x04] = "https://"
 *
 *     → "https://example.com"
 *
 * An empty payload yields an empty string; a reserved prefix index (≥ 0x24)
 * contributes no prefix, per the spec.
 */
export function decodeUriPayload(payload: readonly number[]): string {
  if (!payload.length) return '';

  const prefix = URI_PREFIXES[payload[0] & 0xff] ?? '';
  return prefix + bytesToUtf8(payload.slice(1));
}

/**
 * Decode UTF-16 bytes.
 *
 * NDEF Text records may carry UTF-16, and the status byte says *that* but not
 * which byte order. A BOM settles it when present; the spec's default is
 * big-endian, which is the opposite of most platforms' native order, so
 * assuming little-endian here would be a subtle and very occasional bug.
 *
 * Surrogate pairs are combined explicitly rather than left to
 * `String.fromCharCode`, for the same reason the UTF-8 path uses
 * `fromCodePoint`.
 */
export function bytesToUtf16(
  bytes: readonly number[],
  fallback: 'utf-16be' | 'utf-16le' = 'utf-16be'
): { text: string; encoding: 'utf-16be' | 'utf-16le' } {
  let start = 0;
  let littleEndian = fallback === 'utf-16le';

  // Byte Order Mark, if the writer left one.
  if (bytes.length >= 2) {
    const first = ((bytes[0] & 0xff) << 8) | (bytes[1] & 0xff);
    if (first === 0xfeff) {
      littleEndian = false;
      start = 2;
    } else if (first === 0xfffe) {
      littleEndian = true;
      start = 2;
    }
  }

  const units: number[] = [];
  for (let i = start; i + 1 < bytes.length; i += 2) {
    const a = bytes[i] & 0xff;
    const b = bytes[i + 1] & 0xff;
    units.push(littleEndian ? (b << 8) | a : (a << 8) | b);
  }

  let text = '';
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i];
    const next = units[i + 1];

    // High surrogate followed by a low surrogate — one astral character.
    if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      text += String.fromCodePoint(0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00));
      i += 1;
      continue;
    }

    // A lone surrogate is malformed; do not emit it unpaired.
    if (unit >= 0xd800 && unit <= 0xdfff) {
      text += '�';
      continue;
    }

    text += String.fromCodePoint(unit);
  }

  return { text, encoding: littleEndian ? 'utf-16le' : 'utf-16be' };
}

// ---------------------------------------------------------------------------
// Text records
// ---------------------------------------------------------------------------

/**
 * Decode a Text record payload.
 *
 * Layout (NFC Forum Text RTD):
 *
 *     02 65 6e 48 69
 *     │  └─┬─┘ └─┬─┘
 *     │   "en"  "Hi"
 *     └─ status byte
 *
 * The status byte packs three things:
 *
 *     bit 7    encoding    0 = UTF-8, 1 = UTF-16
 *     bit 6    RFU         must be zero
 *     bits 5-0 length      how many bytes of IANA language code follow
 *
 * The library's implementation reads that length, uses it to skip the language
 * code, and then **throws the language code away** — the line that would keep
 * it is commented out in `ndef-lib/ndef-text.js`, above a `TODO` about UTF.
 * We keep it, because "which language is this text in" is exactly the question
 * a record with a language field exists to answer.
 */
export function decodeTextPayload(payload: readonly number[]): {
  text: string;
  lang: string;
  encoding: TextEncodingName;
} {
  if (!payload.length) return { text: '', lang: '', encoding: 'utf-8' };

  const status = payload[0] & 0xff;
  const isUtf16 = (status & 0x80) !== 0;
  const langLength = status & 0x3f;

  // A language length that runs past the end of the payload means the record is
  // malformed. Clamp rather than throw: show what is there.
  const safeLangLength = Math.min(langLength, Math.max(payload.length - 1, 0));

  const lang = bytesToUtf8(payload.slice(1, 1 + safeLangLength));
  const body = payload.slice(1 + safeLangLength);

  if (isUtf16) {
    const { text, encoding } = bytesToUtf16(body);
    return { text, lang, encoding };
  }

  return { text: bytesToUtf8(body), lang, encoding: 'utf-8' };
}

// ---------------------------------------------------------------------------
// Record dispatch
// ---------------------------------------------------------------------------

/**
 * MIME types we are willing to render as text. Anything else keeps its bytes
 * and shows as a hex dump — guessing that an unknown binary blob is UTF-8
 * produces confident nonsense.
 */
function isTextualMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return (
    m.startsWith('text/') ||
    m === 'application/json' ||
    m === 'application/xml' ||
    m.endsWith('+json') ||
    m.endsWith('+xml')
  );
}

/** Normalise a record's payload, which the library types as `any[]`. */
function payloadBytes(record: NdefRecord): number[] {
  const payload = record.payload as unknown;
  if (!Array.isArray(payload)) return [];
  return payload.map((b) => Number(b) & 0xff);
}

/**
 * Turn one raw record into something renderable.
 *
 * Dispatch is on TNF first, then on the type name — that ordering is the format
 * itself, not a stylistic choice: the same type string means different things
 * under different TNFs.
 */
export function decodeRecord(record: NdefRecord): NdefView {
  const tnf = Number(record.tnf) & 0x07;
  const type = typeToString(record.type);
  const payload = payloadBytes(record);

  switch (tnf) {
    case TNF.EMPTY:
      return { kind: 'empty' };

    case TNF.WELL_KNOWN: {
      if (type === RTD.URI) return { kind: 'uri', uri: decodeUriPayload(payload) };
      if (type === RTD.TEXT) return { kind: 'text', ...decodeTextPayload(payload) };
      return { kind: 'unknown', tnf, type, payload };
    }

    case TNF.MIME_MEDIA: {
      const mime = type;
      return isTextualMime(mime)
        ? { kind: 'mime', mime, text: bytesToUtf8(payload), bytes: payload }
        : { kind: 'mime', mime, bytes: payload };
    }

    // TNF 0x03 puts the URI in the *type* field, not the payload — no prefix
    // byte, no compression. A different shape for the same idea.
    case TNF.ABSOLUTE_URI:
      return { kind: 'uri', uri: type };

    case TNF.EXTERNAL_TYPE: {
      // The Android Application Record: an external-type record whose payload
      // is a package name. Android's NFC dispatch will launch (or offer to
      // install) that app. iOS ignores it entirely — see PLATFORM-NOTES.
      if (type.toLowerCase() === AAR_TYPE) {
        return { kind: 'aar', packageName: bytesToUtf8(payload) };
      }
      return { kind: 'unknown', tnf, type, payload };
    }

    default:
      return { kind: 'unknown', tnf, type, payload };
  }
}

/**
 * Decode a whole message.
 *
 * The parameter is optional on purpose. `TagEvent.ndefMessage` is typed as a
 * required `NdefRecord[]`, but a blank NDEF-formatted tag read on iOS came back
 * with **no `ndefMessage` key at all** (DEVLOG §1.12) — so the library's own
 * types are wrong here, and "absent" and "empty" have to behave identically.
 */
export function decodeMessage(records: readonly NdefRecord[] | undefined): NdefView[] {
  if (!records?.length) return [];
  return records.map(decodeRecord);
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** A short label for one record — used in lists and the Read summary card. */
export function describeView(view: NdefView): string {
  switch (view.kind) {
    case 'empty':
      return 'Empty record';
    case 'uri':
      return view.uri || '(empty URI)';
    case 'text':
      return view.text || '(empty text)';
    case 'mime':
      return view.text?.trim() ? view.text : `${view.mime} · ${view.bytes.length} bytes`;
    case 'aar':
      return `Opens ${view.packageName}`;
    case 'unknown':
      return view.type ? `Unknown record (${view.type})` : `Unknown record (TNF ${view.tnf})`;
  }
}

/** The human-readable record kind, for the Tag Info screen. */
export function kindLabel(view: NdefView): string {
  switch (view.kind) {
    case 'empty':
      return 'Empty';
    case 'uri':
      return 'URI';
    case 'text':
      return `Text · ${view.lang || 'no language'} · ${view.encoding}`;
    case 'mime':
      return `MIME · ${view.mime}`;
    case 'aar':
      return 'Android Application Record';
    case 'unknown':
      return `Unrecognised · TNF 0x${view.tnf.toString(16).padStart(2, '0')}`;
  }
}

/**
 * One line describing the whole tag, for the Read screen's summary card.
 *
 * A blank formatted tag is a real and common state — the chips we tested ship
 * this way — so it gets its own wording rather than reading as a failure.
 */
export function summarise(views: readonly NdefView[]): string {
  if (!views.length) return 'Empty tag — no NDEF records';

  const first = describeView(views[0]);
  if (views.length === 1) return first;

  const rest = views.length - 1;
  return `${first} + ${rest} more record${rest === 1 ? '' : 's'}`;
}

/**
 * Encode a string as UTF-8 bytes.
 *
 * The inverse of `bytesToUtf8`, and it lives beside it deliberately: the two
 * are a pair, and T3 round-trips them against each other. Hand-rolled for the
 * same reason as the decoder — `TextEncoder` is not guaranteed under Hermes.
 */
export function utf8ToBytes(value: string): number[] {
  const out: number[] = [];

  for (const char of value) {
    const cp = char.codePointAt(0) ?? 0;

    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    }
  }

  return out;
}
