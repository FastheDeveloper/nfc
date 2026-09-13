import { describe, expect, it } from '@jest/globals';

import { EMPTY_PROFILE, type Profile } from '../store/profile';
import { decodeMessage, TNF, URI_PREFIXES, utf8ToBytes, bytesToUtf8 } from './ndef';
import {
  compressUri,
  encodeMessage,
  encodedSize,
  mimeRecord,
  textRecord,
  uriRecord,
} from './ndefEncode';
import { toVCard } from './vcard';

/**
 * The library's NDEF helpers, imported at source so the tests never load
 * `NativeModules`. `decodeMessage` here is the bytes → records step, which on
 * a real device is done natively before our decoder ever sees the data — so
 * using it keeps the round-trip faithful to the actual data path rather than
 * shortcutting it.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const libNdef = require('../vendor/react-native-nfc-manager/ndef-lib');
/* eslint-enable @typescript-eslint/no-require-imports */

const CARD: Profile = {
  ...EMPTY_PROFILE,
  name: 'Farouq Seriki',
  title: 'Engineer',
  company: 'Recdek, Ltd',
  phone: '+442071234567',
  email: 'fas@example.com',
  url: 'https://example.com',
};

const GRINNING = String.fromCodePoint(0x1f600);

describe('utf8ToBytes', () => {
  it.each(['TapCard', 'café', '日本語', `hi ${GRINNING}`, ''])('round-trips %s', (value) => {
    expect(bytesToUtf8(utf8ToBytes(value))).toBe(value);
  });

  it('agrees with Node on the bytes themselves', () => {
    expect(utf8ToBytes(`é日${GRINNING}`)).toEqual(
      Array.from(Buffer.from(`é日${GRINNING}`, 'utf8'))
    );
  });
});

describe('compressUri', () => {
  /**
   * The trap: taking the *first* matching prefix rather than the longest.
   * `https://` (0x04) matches `https://www.example.com`, but `https://www.`
   * (0x02) matches too and saves four more bytes.
   */
  it('prefers the longest matching prefix', () => {
    expect(compressUri('https://www.example.com')).toEqual({ index: 0x02, rest: 'example.com' });
    expect(compressUri('http://www.example.com')).toEqual({ index: 0x01, rest: 'example.com' });
  });

  it('falls back to the shorter prefix when the longer does not match', () => {
    expect(compressUri('https://example.com')).toEqual({ index: 0x04, rest: 'example.com' });
  });

  it('uses no prefix for a scheme that is not in the table', () => {
    expect(compressUri('geo:51.5,-0.1')).toEqual({ index: 0, rest: 'geo:51.5,-0.1' });
  });

  it('handles a URI that is exactly a prefix', () => {
    expect(compressUri('https://')).toEqual({ index: 0x04, rest: '' });
  });

  it('handles an empty string', () => {
    expect(compressUri('')).toEqual({ index: 0, rest: '' });
  });

  it('saves real bytes — the whole reason the table exists', () => {
    const compressed = encodedSize([uriRecord('https://www.example.com')]);
    const raw = encodedSize([uriRecord('geo:www.example.com')]);

    // Same tail length, but one gets 12 characters for free.
    expect(compressed).toBeLessThan(raw);
  });
});

describe('record headers', () => {
  it('sets MB, ME and SR on a lone short record', () => {
    const [header] = encodeMessage([uriRecord('https://a.co')]);

    expect(header & 0x80).toBe(0x80); // Message Begin
    expect(header & 0x40).toBe(0x40); // Message End
    expect(header & 0x20).toBe(0x00); // never chunked
    expect(header & 0x10).toBe(0x10); // Short Record
    expect(header & 0x08).toBe(0x00); // no ID
    expect(header & 0x07).toBe(TNF.WELL_KNOWN);
  });

  it('marks only the first and last record of a multi-record message', () => {
    const bytes = encodeMessage([
      uriRecord('https://a.co'),
      textRecord('middle'),
      textRecord('last'),
    ]);
    const records = libNdef.decodeMessage(bytes);

    expect(records).toHaveLength(3);
    // Decoding three records back out is the observable proof MB/ME are right:
    // a wrong flag truncates the message or runs the records together.
    expect(decodeMessage(records).map((v) => v.kind)).toEqual(['uri', 'text', 'text']);
  });

  it('drops the Short Record flag once the payload exceeds 254 bytes', () => {
    const [header] = encodeMessage([mimeRecord('text/plain', 'x'.repeat(300))]);

    expect(header & 0x10).toBe(0x00);
  });

  it('uses a four-byte length for a long record', () => {
    const long = encodeMessage([mimeRecord('text/plain', 'x'.repeat(300))]);
    const short = encodeMessage([mimeRecord('text/plain', 'x')]);

    // header + type length + payload length field + type + payload
    expect(long.length).toBe(1 + 1 + 4 + 'text/plain'.length + 300);
    expect(short.length).toBe(1 + 1 + 1 + 'text/plain'.length + 1);
  });
});

describe('round-trip: encode then decode', () => {
  const roundTrip = (records: Parameters<typeof encodeMessage>[0]) =>
    decodeMessage(libNdef.decodeMessage(encodeMessage(records)));

  it('a URI survives intact', () => {
    expect(roundTrip([uriRecord('https://www.example.com/x?a=1&b=2#frag')])).toEqual([
      { kind: 'uri', uri: 'https://www.example.com/x?a=1&b=2#frag' },
    ]);
  });

  it('a URI with no table prefix survives intact', () => {
    expect(roundTrip([uriRecord('geo:51.5074,-0.1278')])).toEqual([
      { kind: 'uri', uri: 'geo:51.5074,-0.1278' },
    ]);
  });

  it('a vCard survives intact, CRLFs and all', () => {
    const body = toVCard(CARD);

    expect(roundTrip([mimeRecord('text/vcard', body)])).toEqual([
      { kind: 'mime', mime: 'text/vcard', text: body, bytes: utf8ToBytes(body) },
    ]);
  });

  it('text keeps its language tag and its emoji', () => {
    expect(roundTrip([textRecord(`hi ${GRINNING}`, 'en-GB')])).toEqual([
      { kind: 'text', text: `hi ${GRINNING}`, lang: 'en-GB', encoding: 'utf-8' },
    ]);
  });

  it('every prefix in the table round-trips', () => {
    URI_PREFIXES.forEach((prefix, index) => {
      if (index === 0) return;

      const uri = `${prefix}rest`;
      const [view] = roundTrip([uriRecord(uri)]);

      expect(view).toEqual({ kind: 'uri', uri });
    });
  });
});

describe('agreement with the library encoder', () => {
  it.each([
    'https://example.com',
    'https://www.example.com',
    'http://example.com',
    'tel:+442071234567',
    'mailto:fas@example.com',
    'geo:51.5074,-0.1278',
  ])('produces identical bytes for %s', (uri) => {
    expect(encodeMessage([uriRecord(uri)])).toEqual(
      Array.from(libNdef.encodeMessage([libNdef.uriRecord(uri)]))
    );
  });
});

describe('encodedSize', () => {
  it('is exactly the length of the encoded message', () => {
    const records = [uriRecord('https://example.com')];

    expect(encodedSize(records)).toBe(encodeMessage(records).length);
  });

  /**
   * The numbers Phase 3's capacity story rests on. Pinned deliberately: if the
   * encoder changes and these move, the capacity warnings and the article's
   * figures need revisiting together.
   */
  it('a short URL costs 20 bytes', () => {
    expect(encodedSize([uriRecord('https://example.com/fas')])).toBe(20);
  });

  it('a realistic vCard costs 213 bytes — over an NTAG213 budget', () => {
    expect(encodedSize([mimeRecord('text/vcard', toVCard(CARD))])).toBe(213);
  });

  it('the vCard is an order of magnitude larger than the URL', () => {
    const url = encodedSize([uriRecord('https://example.com/fas')]);
    const vcard = encodedSize([mimeRecord('text/vcard', toVCard(CARD))]);

    expect(vcard).toBeGreaterThan(url * 10);
  });
});

describe('the empty message', () => {
  /**
   * `d0 00 00` — MB + ME + SR set, TNF 0x00, no type, no payload. This is how
   * NDEF says "formatted and deliberately blank", and it is what the
   * factory-fresh NTAG213 we read in Phase 1 was carrying.
   */
  it('is a single empty record, not zero bytes', () => {
    expect(encodeMessage([])).toEqual([0xd0, 0x00, 0x00]);
  });

  it('decodes back to a single empty view', () => {
    expect(decodeMessage(libNdef.decodeMessage(encodeMessage([])))).toEqual([{ kind: 'empty' }]);
  });
});
