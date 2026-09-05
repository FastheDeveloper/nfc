/**
 * Will it fit?
 *
 * **Corrected 2026-09-05 on hardware.** This module was built on the belief
 * that iOS cannot report tag capacity. That was wrong, and the mistake is
 * worth keeping visible: what we *observed* in Phase 1 was that `getTag()`
 * returns only `{ id, tech }`. What we *concluded* was that the platform
 * cannot answer the question. Those are different claims, and the second does
 * not follow from the first.
 *
 * `ndefHandler.getNdefStatus()` → CoreNFC's `queryNDEFStatus` returns both a
 * read/write status and a capacity, inside the session `requestTechnology`
 * already opens. A real NTAG213 on iPhone "Fas" reported **137 bytes**.
 *
 * An assumption is still needed, but only *before* a session — the number is
 * knowable only while a tag is present. Once one has answered, the app uses
 * the measured figure and says so.
 *
 * The 137 also corrected the assumption itself. We had compared against 144,
 * the NTAG213's raw user memory, when the number that matters is the maximum
 * NDEF *message*, smaller by the tag's own bookkeeping. 144 was seven bytes
 * too generous.
 *
 * Pure — no react-native imports.
 */

import { encodedSize } from './ndefEncode';
import type { NdefRecord } from 'react-native-nfc-manager';

/**
 * The maximum NDEF message an NTAG213 holds: **137 bytes**.
 *
 * Measured, not read off a datasheet — what a real chip reported through
 * `queryNDEFStatus` on 2026-09-05. The chip's *user memory* is 144 bytes (36
 * pages of 4, pages 4–39); the seven-byte difference is the tag's own
 * bookkeeping, which we do not model because we do not need to: the tag
 * states the number that matters directly.
 *
 * Still an assumption when no tag is present, and still wrong for an NTAG215
 * or NTAG216 — **nothing in the UID can tell them apart**, which
 * `lib/manufacturer.ts` has a test asserting.
 */
export const NTAG213_NDEF_BYTES = 137;

export type CapacityVerdict = 'fits' | 'tight' | 'too-big';

export type Capacity = {
  /** The NDEF message itself. */
  messageBytes: number;
  /**
   * The TLV the tag wraps around the message. **Informational only.**
   *
   * An earlier version added this to the message and compared the total
   * against raw user memory. That double-counted: a reported capacity and the
   * corrected assumption are both already *message* sizes with the framing
   * taken out. Still shown, because it explains where the missing bytes go.
   */
  tlvBytes: number;
  /** What we compare against the budget. Equal to `messageBytes`. */
  requiredBytes: number;
  budget: number;
  /** Whether `budget` was measured or assumed. Drives the UI's honesty. */
  basis: 'reported' | 'assumed';
  verdict: CapacityVerdict;
  /** Spare bytes. Negative when it will not fit. */
  headroom: number;
};

/**
 * The framing a type-2 tag puts around an NDEF message.
 *
 * The message does not sit bare in user memory. It is wrapped in a TLV:
 *
 *     03 <length> <message bytes…> FE
 *     │  │                          └─ Terminator TLV
 *     │  └─ length: 1 byte, or 3 bytes (FF + 16-bit) once the message hits 255
 *     └─ tag: 03 = NDEF Message
 *
 * Three bytes of overhead on a 144-byte budget is two percent, which is worth
 * counting when a realistic vCard already misses by 70.
 */
export function tlvOverhead(messageBytes: number): number {
  const lengthField = messageBytes < 0xff ? 1 : 3;
  return 1 + lengthField + 1;
}

/**
 * Assess a message against what we know, or assume, about the tag.
 *
 * `reportedMaxSize` is Android's `Ndef.getMaxSize()`, which is the maximum
 * **message** size and already accounts for the framing. Our own NTAG213
 * figure is raw **user memory**, which does not. Comparing the same number
 * against both would be wrong by exactly the TLV overhead, so the two paths
 * compare different quantities on purpose.
 */
export function assessCapacity(records: readonly NdefRecord[], reportedMaxSize?: number): Capacity {
  const messageBytes = encodedSize(records);

  const reported = typeof reportedMaxSize === 'number' && reportedMaxSize > 0;

  // Both budgets are maximum *message* sizes, so both compare against the
  // message. The framing is reported for interest, never added.
  const tlvBytes = tlvOverhead(messageBytes);
  const requiredBytes = messageBytes;
  const budget = reported ? reportedMaxSize : NTAG213_NDEF_BYTES;
  const headroom = budget - requiredBytes;

  return {
    messageBytes,
    tlvBytes,
    requiredBytes,
    budget,
    basis: reported ? 'reported' : 'assumed',
    verdict: verdictFor(requiredBytes, budget),
    headroom,
  };
}

/**
 * `tight` exists so a card that *just* fits does not look identical to one
 * with room to spare. On an assumed budget in particular, being within ten
 * percent means the assumption itself could be what decides the outcome.
 */
function verdictFor(required: number, budget: number): CapacityVerdict {
  if (required > budget) return 'too-big';
  if (required > budget * 0.9) return 'tight';
  return 'fits';
}

/** Short user-facing summary. */
export function capacityTitle(capacity: Capacity): string {
  switch (capacity.verdict) {
    case 'fits':
      return 'Fits comfortably';
    case 'tight':
      return 'Only just fits';
    case 'too-big':
      return 'Too big for this tag';
  }
}

/**
 * The sentence under the title.
 *
 * On an assumed budget it names the assumption every time. Repetitive by
 * design: the moment the app stops saying "assuming", a reader starts
 * believing it measured something.
 */
export function capacityDetail(capacity: Capacity): string {
  const { requiredBytes, budget, basis, headroom } = capacity;

  const sizes =
    basis === 'reported'
      ? `${requiredBytes} of the ${budget} bytes this tag reports.`
      : `${requiredBytes} bytes, assuming an NTAG213's ${budget}.`;

  if (capacity.verdict === 'too-big') {
    return `${sizes} It is ${Math.abs(headroom)} bytes over — shorten the profile or write a link instead.`;
  }

  return `${sizes} ${headroom} bytes spare.`;
}

/** Why the number might be wrong. Null when it was actually measured. */
export function capacityCaveat(capacity: Capacity): string | null {
  if (capacity.basis === 'reported') return null;

  return 'No tag has reported its size yet, so this assumes an NTAG213. Tags state their real capacity when you write to them.';
}
