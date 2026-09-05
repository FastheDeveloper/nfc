/**
 * N7 — guessing the chip from its UID.
 *
 * The first byte of an NFC tag's UID is an IC manufacturer code assigned by the
 * ISO/IEC 7816-6 registration authority. NXP is `0x04`, which covers the entire
 * NTAG and MIFARE family and therefore almost every hobby tag sold.
 *
 * **This is inference, not measurement, and the UI must say so.** It was left
 * out of Phase 2 deliberately (DEVLOG §2.8) because it is precisely the
 * hardcoded lookup that rots as new silicon ships — a table like this is
 * out of date the moment someone registers a new code.
 *
 * It earns its place only because of what it demonstrates: JavaScript can infer
 * *who made the chip* from a byte it already has, and still cannot learn *how
 * big the chip is*, because that requires talking to the tag's capability
 * container. Sitting next to the empty capacity row, it sharpens the Phase 4
 * argument rather than blurring it — the gap is not "iOS tells us less", it is
 * "some questions need a command sent to the tag".
 */

/** ISO/IEC 7816-6 manufacturer codes, the handful that turn up in practice. */
const MANUFACTURERS: Record<number, string> = {
  0x02: 'STMicroelectronics',
  0x04: 'NXP Semiconductors',
  0x05: 'Infineon Technologies',
  0x07: 'Texas Instruments',
  0x16: 'EM Microelectronic-Marin',
  0x21: 'EM Microelectronic-Marin',
  0x28: 'LG Semiconductors',
  0x2b: 'Shanghai Fudan Microelectronics',
  0x44: 'GEMALTO',
};

export type ChipGuess = {
  manufacturer: string;
  /** Present only when the UID length narrows it further. */
  family?: string;
};

/**
 * Infer what we can from a UID.
 *
 * Returns `null` rather than "Unknown" when the code is unrecognised — a
 * missing row is honest; a row reading "Unknown" implies we looked the tag up
 * somewhere and it was not there.
 */
export function guessChip(id: string | undefined): ChipGuess | null {
  if (!id) return null;

  const hex = id.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length < 2) return null;

  const manufacturer = MANUFACTURERS[parseInt(hex.slice(0, 2), 16)];
  if (!manufacturer) return null;

  // A 7-byte UID from NXP is the NTAG21x / MIFARE Ultralight shape. A 4-byte
  // UID is the older MIFARE Classic shape. This is as far as a UID alone can
  // take you — it cannot distinguish an NTAG213 from an NTAG216, which is
  // exactly the distinction the capacity question needs.
  const bytes = hex.length / 2;
  if (parseInt(hex.slice(0, 2), 16) === 0x04) {
    if (bytes === 7) return { manufacturer, family: 'NTAG21x / MIFARE Ultralight (7-byte UID)' };
    if (bytes === 4) return { manufacturer, family: 'MIFARE Classic (4-byte UID)' };
  }

  return { manufacturer };
}
