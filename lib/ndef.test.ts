/**
 * NDEF decoder tests.
 *
 * Three groups, and the split is the point:
 *
 *   1. CORRECTNESS  — our decoder against hand-built payloads.
 *   2. AGREEMENT    — where the library is right, prove we match it exactly.
 *   3. DIVERGENCE   — where the library is wrong, pin the wrongness in a test.
 *
 * Group 3 needs justifying, because asserting that a dependency is broken looks
 * perverse. These are *characterisation* tests: they document why `lib/ndef.ts`
 * exists at all, and they fail the day the library is fixed — which is exactly
 * when we should reconsider hand-rolling. A comment saying "the library is
 * buggy" rots silently; a test saying so does not.
 *
 * None of this needs a device, an emulator or a native build.
 */
import { describe, expect, it } from '@jest/globals';

import {
  AAR_TYPE,
  bytesToHex,
  bytesToUtf16,
  bytesToUtf8,
  decodeMessage,
  decodeRecord,
  decodeTextPayload,
  decodeUriPayload,
  describeView,
  kindLabel,
  summarise,
  TNF,
  typeToString,
  URI_PREFIXES,
  type NdefView,
} from './ndef';

/**
 * The library's decoders — now a **vendored copy**, since the package itself
 * was removed in Phase 4 T10. See `vendor/react-native-nfc-manager/README.md`
 * for why a deleted dependency is still in the repository: these tests are the
 * executable evidence for why `lib/ndef.ts` was written by hand, and they would
 * have evaporated along with the package.
 *
 * Note the signature mismatch while we are here: `index.d.ts` declares
 * `decodePayload(data: Uint8Array)`, but the implementation indexes and slices,
 * so it works fine on the `number[]` that tags actually produce. The types and
 * the code disagree, and the code is the honest one.
 */
type Decoder = { decodePayload: (data: number[]) => string };
type Encoder = { encodePayload: (value: string) => number[] };
/* eslint-disable @typescript-eslint/no-require-imports */
const libUri: Decoder & Encoder = require('../vendor/react-native-nfc-manager/ndef-lib/ndef-uri');
const libText: Decoder = require('../vendor/react-native-nfc-manager/ndef-lib/ndef-text');
/* eslint-enable @typescript-eslint/no-require-imports */

/** UTF-8 encode, for building payloads by hand. */
const utf8 = (s: string): number[] => Array.from(Buffer.from(s, 'utf8'));

/** Build a raw record the way the native side hands them to us. */
const record = (tnf: number, type: number[] | string, payload: number[]) =>
  ({ tnf, type, payload }) as unknown as Parameters<typeof decodeRecord>[0];

const GRINNING = String.fromCodePoint(0x1f600);

// ---------------------------------------------------------------------------
// 1. Correctness
// ---------------------------------------------------------------------------

describe('bytesToUtf8', () => {
  it('decodes ASCII', () => {
    expect(bytesToUtf8(utf8('TapCard'))).toBe('TapCard');
  });

  it('decodes 2- and 3-byte sequences', () => {
    expect(bytesToUtf8(utf8('café'))).toBe('café');
    expect(bytesToUtf8(utf8('日本語'))).toBe('日本語');
  });

  it('decodes 4-byte sequences above U+FFFF', () => {
    expect(bytesToUtf8(utf8(`hi ${GRINNING}`))).toBe(`hi ${GRINNING}`);
  });

  it('replaces a truncated sequence instead of throwing', () => {
    // A 4-byte leader followed by only one continuation byte.
    expect(bytesToUtf8([0xf0, 0x9f])).toBe('��');
  });

  it('replaces a stray continuation byte', () => {
    expect(bytesToUtf8([0x80, 0x41])).toBe('�A');
  });

  it('returns empty for no bytes', () => {
    expect(bytesToUtf8([])).toBe('');
  });
});

describe('bytesToUtf16', () => {
  it('defaults to big-endian, per the spec', () => {
    expect(bytesToUtf16([0x00, 0x48, 0x00, 0x69])).toEqual({ text: 'Hi', encoding: 'utf-16be' });
  });

  it('honours a big-endian BOM', () => {
    expect(bytesToUtf16([0xfe, 0xff, 0x00, 0x48])).toEqual({ text: 'H', encoding: 'utf-16be' });
  });

  it('honours a little-endian BOM', () => {
    expect(bytesToUtf16([0xff, 0xfe, 0x48, 0x00])).toEqual({ text: 'H', encoding: 'utf-16le' });
  });

  it('combines surrogate pairs into one character', () => {
    // U+1F600 as UTF-16BE: D83D DE00
    expect(bytesToUtf16([0xd8, 0x3d, 0xde, 0x00]).text).toBe(GRINNING);
  });

  it('replaces a lone surrogate', () => {
    expect(bytesToUtf16([0xd8, 0x3d]).text).toBe('�');
  });
});

describe('bytesToHex / typeToString', () => {
  it('pads and lower-cases', () => {
    expect(bytesToHex([0x04, 0xc4, 0x0f])).toBe('04 c4 0f');
  });

  it('labels an empty payload', () => {
    expect(bytesToHex([])).toBe('(empty)');
    expect(bytesToHex(undefined)).toBe('(empty)');
  });

  it('accepts a type as bytes (Android) or a string (iOS)', () => {
    expect(typeToString([0x55])).toBe('U');
    expect(typeToString('U')).toBe('U');
    expect(typeToString(undefined)).toBe('');
  });
});

describe('decodeUriPayload', () => {
  it('expands the prefix byte', () => {
    expect(decodeUriPayload([0x04, ...utf8('example.com')])).toBe('https://example.com');
  });

  it('handles prefix 0x00 — no prefix at all', () => {
    expect(decodeUriPayload([0x00, ...utf8('geo:51.5,-0.1')])).toBe('geo:51.5,-0.1');
  });

  it('treats a reserved index (>= 0x24) as no prefix', () => {
    expect(decodeUriPayload([0xff, ...utf8('weird')])).toBe('weird');
  });

  it('returns empty for an empty payload', () => {
    expect(decodeUriPayload([])).toBe('');
  });

  it('has the full 36-entry table', () => {
    expect(URI_PREFIXES).toHaveLength(36);
    expect(URI_PREFIXES[0x04]).toBe('https://');
    expect(URI_PREFIXES[0x23]).toBe('urn:nfc:');
  });
});

describe('decodeTextPayload', () => {
  it('keeps the language code', () => {
    expect(decodeTextPayload([0x02, ...utf8('en'), ...utf8('Hi')])).toEqual({
      text: 'Hi',
      lang: 'en',
      encoding: 'utf-8',
    });
  });

  it('reads UTF-16 from the status byte high bit', () => {
    expect(decodeTextPayload([0x82, ...utf8('en'), 0x00, 0x48, 0x00, 0x69])).toEqual({
      text: 'Hi',
      lang: 'en',
      encoding: 'utf-16be',
    });
  });

  it('supports a longer language tag', () => {
    expect(decodeTextPayload([0x05, ...utf8('en-GB'), ...utf8('Hi')]).lang).toBe('en-GB');
  });

  it('clamps a language length that overruns the payload', () => {
    // Claims 63 bytes of language code in a 2-byte payload.
    expect(decodeTextPayload([0x3f, 0x65])).toEqual({ text: '', lang: 'e', encoding: 'utf-8' });
  });

  it('returns empty for an empty payload', () => {
    expect(decodeTextPayload([])).toEqual({ text: '', lang: '', encoding: 'utf-8' });
  });
});

describe('decodeRecord dispatch', () => {
  it('TNF 0x00 — empty', () => {
    expect(decodeRecord(record(TNF.EMPTY, [], []))).toEqual({ kind: 'empty' });
  });

  it('TNF 0x01 "U" — URI, from Android bytes', () => {
    expect(decodeRecord(record(TNF.WELL_KNOWN, [0x55], [0x04, ...utf8('a.dev')]))).toEqual({
      kind: 'uri',
      uri: 'https://a.dev',
    });
  });

  it('TNF 0x01 "U" — URI, from an iOS string type', () => {
    expect(decodeRecord(record(TNF.WELL_KNOWN, 'U', [0x04, ...utf8('a.dev')]))).toEqual({
      kind: 'uri',
      uri: 'https://a.dev',
    });
  });

  it('TNF 0x01 "T" — text', () => {
    expect(
      decodeRecord(record(TNF.WELL_KNOWN, [0x54], [0x02, ...utf8('en'), ...utf8('Hi')]))
    ).toEqual({
      kind: 'text',
      text: 'Hi',
      lang: 'en',
      encoding: 'utf-8',
    });
  });

  it('TNF 0x01 with an unhandled RTD falls back to unknown', () => {
    expect(decodeRecord(record(TNF.WELL_KNOWN, utf8('Sp'), [0x01])).kind).toBe('unknown');
  });

  it('TNF 0x02 — textual MIME decodes its body', () => {
    expect(
      decodeRecord(record(TNF.MIME_MEDIA, utf8('text/vcard'), utf8('BEGIN:VCARD')))
    ).toMatchObject({
      kind: 'mime',
      mime: 'text/vcard',
      text: 'BEGIN:VCARD',
    });
  });

  it('TNF 0x02 — binary MIME keeps bytes only', () => {
    expect(decodeRecord(record(TNF.MIME_MEDIA, utf8('image/png'), [0x89, 0x50]))).toEqual({
      kind: 'mime',
      mime: 'image/png',
      bytes: [0x89, 0x50],
    });
  });

  it('TNF 0x03 — absolute URI lives in the type field', () => {
    expect(decodeRecord(record(TNF.ABSOLUTE_URI, utf8('https://x.dev'), []))).toEqual({
      kind: 'uri',
      uri: 'https://x.dev',
    });
  });

  it('TNF 0x04 android.com:pkg — Android Application Record', () => {
    expect(
      decodeRecord(record(TNF.EXTERNAL_TYPE, utf8(AAR_TYPE), utf8('com.nfccard.tap')))
    ).toEqual({
      kind: 'aar',
      packageName: 'com.nfccard.tap',
    });
  });

  it('TNF 0x04 with any other type is unknown, but keeps its bytes', () => {
    const view = decodeRecord(record(TNF.EXTERNAL_TYPE, utf8('example.com:thing'), [0xde, 0xad]));
    expect(view).toEqual({
      kind: 'unknown',
      tnf: TNF.EXTERNAL_TYPE,
      type: 'example.com:thing',
      payload: [0xde, 0xad],
    });
  });

  it('tolerates a missing payload', () => {
    expect(decodeRecord(record(TNF.WELL_KNOWN, [0x55], undefined as unknown as number[]))).toEqual({
      kind: 'uri',
      uri: '',
    });
  });
});

describe('decodeMessage', () => {
  /**
   * `TagEvent.ndefMessage` is typed as a required `NdefRecord[]`, but the blank
   * NDEF-formatted tag we read on iPhone "Fas" came back with no `ndefMessage`
   * key at all (DEVLOG §1.12). Absent and empty must therefore be the same
   * thing to every caller.
   */
  it('treats an absent message exactly like an empty one', () => {
    expect(decodeMessage(undefined)).toEqual(decodeMessage([]));
    expect(decodeMessage(undefined)).toEqual([]);
  });

  it('decodes several records in order', () => {
    const views = decodeMessage([
      record(TNF.WELL_KNOWN, [0x55], [0x04, ...utf8('a.dev')]),
      record(TNF.WELL_KNOWN, [0x54], [0x02, ...utf8('en'), ...utf8('Hi')]),
    ]);
    expect(views.map((v) => v.kind)).toEqual(['uri', 'text']);
  });
});

describe('presentation', () => {
  it('summarises a blank tag without sounding like a failure', () => {
    expect(summarise([])).toBe('Empty tag — no NDEF records');
  });

  it('summarises a single record as itself', () => {
    expect(summarise([{ kind: 'uri', uri: 'https://a.dev' }])).toBe('https://a.dev');
  });

  it('pluralises the overflow count', () => {
    const uri: NdefView = { kind: 'uri', uri: 'https://a.dev' };
    expect(summarise([uri, { kind: 'empty' }])).toBe('https://a.dev + 1 more record');
    expect(summarise([uri, { kind: 'empty' }, { kind: 'empty' }])).toBe(
      'https://a.dev + 2 more records'
    );
  });

  it('labels an AAR as the Android-only thing it is', () => {
    expect(describeView({ kind: 'aar', packageName: 'com.nfccard.tap' })).toBe(
      'Opens com.nfccard.tap'
    );
    expect(kindLabel({ kind: 'aar', packageName: 'com.nfccard.tap' })).toBe(
      'Android Application Record'
    );
  });

  it('names the encoding and language of a text record', () => {
    expect(kindLabel({ kind: 'text', text: 'Hi', lang: 'en', encoding: 'utf-16be' })).toBe(
      'Text · en · utf-16be'
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Agreement — where the library is correct, match it exactly
// ---------------------------------------------------------------------------

describe('agreement with the library: URI records', () => {
  const URIS = [
    'https://example.com',
    'https://www.example.com',
    'http://example.com',
    'http://www.example.com',
    'tel:+442071234567',
    'mailto:fas@example.com',
    'ftp://ftp.example.com/pub',
    'file:///etc/hosts',
    'urn:nfc:ext:example.com:thing',
    'sip:alice@example.com',
    'geo:51.5074,-0.1278', // no table prefix applies
    'https://example.com/path?q=1&r=2#frag',
  ];

  it.each(URIS)('round-trips %s identically to the library', (uri) => {
    // Encode with the library, decode with both. If our prefix table or our
    // offset were wrong, these would part company immediately.
    const payload = libUri.encodePayload(uri);
    expect(decodeUriPayload(payload)).toBe(uri);
    expect(decodeUriPayload(payload)).toBe(libUri.decodePayload(payload));
  });

  it('agrees across every defined prefix index', () => {
    URI_PREFIXES.forEach((prefix, index) => {
      const payload = [index, ...utf8('rest')];
      expect(decodeUriPayload(payload)).toBe(`${prefix}rest`);
      expect(decodeUriPayload(payload)).toBe(libUri.decodePayload(payload));
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Divergence — where the library is wrong, pin it
// ---------------------------------------------------------------------------

describe('divergence from the library: text records', () => {
  /**
   * `ndef-lib/ndef-text.js` computes the language code's length and uses it to
   * skip past the language code, but the line that would *keep* it is
   * commented out. Its decoder returns a bare string, so the caller has no way
   * to recover the language at all.
   */
  it('the library discards the language code; we keep it', () => {
    const payload = [0x02, ...utf8('en'), ...utf8('Hi')];

    expect(libText.decodePayload(payload)).toBe('Hi');
    expect(decodeTextPayload(payload)).toEqual({ text: 'Hi', lang: 'en', encoding: 'utf-8' });
  });

  /**
   * `ndef-lib/util.js` accumulates with `String.fromCharCode`, which takes the
   * low 16 bits. U+1F600 becomes U+F600 — a Private Use Area character that
   * renders as nothing.
   */
  it('the library truncates 4-byte UTF-8; we do not', () => {
    const payload = [0x02, ...utf8('en'), ...utf8(GRINNING)];

    const theirs = libText.decodePayload(payload);
    expect(theirs).not.toBe(GRINNING);
    expect(theirs.codePointAt(0)).toBe(0xf600); // truncated from 0x1F600
    expect(decodeTextPayload(payload).text).toBe(GRINNING);
  });

  it('both handle 3-byte sequences — the bug is specific to astral planes', () => {
    const payload = [0x02, ...utf8('ja'), ...utf8('日本語')];

    expect(libText.decodePayload(payload)).toBe('日本語');
    expect(decodeTextPayload(payload).text).toBe('日本語');
  });

  /**
   * The library's UTF-16 handling is an open TODO — it ignores the status
   * byte's encoding bit entirely and decodes the body as UTF-8 regardless.
   */
  it('the library ignores the UTF-16 flag; we honour it', () => {
    const payload = [0x82, ...utf8('en'), 0x00, 0x48, 0x00, 0x69];

    expect(libText.decodePayload(payload)).not.toBe('Hi');
    expect(decodeTextPayload(payload).text).toBe('Hi');
  });
});
