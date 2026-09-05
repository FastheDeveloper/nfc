/**
 * Turning a raw tag into rows a screen can render.
 *
 * The whole reason this module exists is the third state. A tag fact is not
 * just "a value" or "zero" — it can be **"this platform does not tell us"**,
 * which is a different thing and must not be rendered as a blank or a dash.
 *
 * We learned that the hard way in Phase 1: reading an NTAG213 on iOS returned
 * exactly two fields, `{ id, tech }`. No `maxSize`, no `techTypes`, no `type` —
 * not null, *absent* (DEVLOG §1.12). Android returns all of them for the same
 * physical chip. A UI that renders "—" for both cases tells the reader nothing;
 * a UI that says "Not reported on iOS" tells them something true about the
 * platform, which is the entire subject of this project.
 *
 * Like `lib/ndef.ts`, this module takes the platform as an argument rather than
 * importing `Platform` from react-native, so it stays testable without a
 * device.
 */

import type { TagEvent } from 'react-native-nfc-manager';

/**
 * What the native side actually hands back.
 *
 * `TagEvent` is the library's declared shape, but it is not the whole truth:
 * iOS adds a `tech` string that the type never mentions, and `ndefMessage` is
 * declared required yet came back absent from a blank tag. Widening it here,
 * once, keeps the casts out of the screens.
 */
export type RawTag = Partial<TagEvent> & {
  tech?: string;
  isWritable?: boolean;
};

export type TargetOs = 'ios' | 'android';

/**
 * One row on the Tag Info screen.
 *
 * `value: null` means the platform did not report it. `unavailable` says why,
 * in the user's language; `footnote` is where we admit what we intend to do
 * about it.
 */
export type Fact = {
  label: string;
  value: string | null;
  unavailable?: string;
  footnote?: string;
};

/** `04C4FC91DF2A81` → `04:C4:FC:91:DF:2A:81`, which is how UIDs are usually written. */
export function formatUid(id: string | undefined): string | null {
  if (!id) return null;

  const hex = id.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (!hex.length) return null;

  return (hex.match(/.{1,2}/g) ?? []).join(':');
}

/**
 * Build the rows for a scanned tag.
 *
 * Order matters: identity first (what is this thing), then capability (what can
 * it do), then contents. The capacity row is deliberately kept even when it has
 * no value, because its absence *is* the finding.
 */
export function tagFacts(tag: RawTag | null, os: TargetOs): Fact[] {
  if (!tag) return [];

  const uid = formatUid(tag.id);
  const recordCount = tag.ndefMessage?.length ?? 0;

  const facts: Fact[] = [
    {
      label: 'Identifier',
      value: uid,
      unavailable: uid ? undefined : 'This tag reported no UID.',
    },
    technologyFact(tag, os),
    {
      label: 'NDEF type',
      value: tag.type ?? null,
      unavailable:
        tag.type == null
          ? os === 'ios'
            ? 'CoreNFC does not report the NDEF type name.'
            : 'Not reported for this tag.'
          : undefined,
    },
    capacityFact(tag, os),
    {
      label: 'Records',
      value: String(recordCount),
    },
  ];

  // `isWritable` only ever arrives from Android. Show it when it is there
  // rather than inventing a row that is permanently empty on iOS.
  if (typeof tag.isWritable === 'boolean') {
    facts.push({ label: 'Writable', value: tag.isWritable ? 'Yes' : 'No' });
  }

  return facts;
}

/**
 * Android reports a list of technologies (`android.nfc.tech.Ndef`,
 * `MifareUltralight`, …). iOS reports a single family string — the blank NTAG
 * we tested came back as `mifare`. Two different questions with the same name.
 */
function technologyFact(tag: RawTag, os: TargetOs): Fact {
  if (tag.techTypes?.length) {
    return { label: 'Technology', value: tag.techTypes.join(', ') };
  }

  if (tag.tech) {
    return {
      label: 'Technology',
      value: tag.tech,
      footnote:
        os === 'ios'
          ? 'iOS reports one family name; Android lists every supported technology.'
          : undefined,
    };
  }

  return { label: 'Technology', value: null, unavailable: 'Not reported for this tag.' };
}

/**
 * The capacity row.
 *
 * **Corrected 2026-09-05.** This row used to claim CoreNFC cannot report
 * capacity. It can — `ndefHandler.getNdefStatus()` returns it, and a real
 * NTAG213 answered 137 bytes. What is true is narrower: a *read* does not
 * carry it. `getTag()` returns `{ id, tech }` and nothing more, so on this
 * screen — which shows the result of a read — there genuinely is no number.
 *
 * The distinction matters and the copy now makes it: the capacity is missing
 * because of *which call was made*, not because the platform cannot answer.
 * Saying "iOS cannot do this" when the truth is "we did not ask" is the kind
 * of claim this project exists to avoid.
 */
function capacityFact(tag: RawTag, os: TargetOs): Fact {
  if (typeof tag.maxSize === 'number') {
    return {
      label: 'Capacity',
      value: `${tag.maxSize} bytes`,
      footnote: 'Reported by the tag itself.',
    };
  }

  if (os === 'ios') {
    return {
      label: 'Capacity',
      value: null,
      unavailable: 'A tag read does not report capacity.',
      footnote: 'Tags state their real size during a write — see the Write tab.',
    };
  }

  return { label: 'Capacity', value: null, unavailable: 'Not reported for this tag.' };
}
