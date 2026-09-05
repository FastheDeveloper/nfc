# Phase 2 — Read & Tag Info, full NDEF parsing

Working state, not article material. DEVLOG.md and PLATFORM-NOTES.md are the deliverables.

**Status:** T0–T11 done · T12 (commit) next · T9 awaiting device confirmation · started 2026-09-05

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[⛔]` blocked on hardware

---

## Decisions taken into this phase

| Decision              | Choice                                                                       |
| --------------------- | ---------------------------------------------------------------------------- |
| NDEF decoding         | **Hand-rolled**, cross-checked against the library only where it is correct  |
| Record coverage       | URI, Text, MIME, Empty, **Android Application Record**, hex fallback         |
| Screen shape          | Lean Read tab + **separate `/tag` route** for Tag Info                       |
| Error handling        | **Typed mapper** + collapsed Developer detail; `UserCancel` renders nothing  |
| Phase 4 hook          | Tag Info shows "not reported on this platform" as a first-class state        |

---

## Tasks

### T0 — Test harness ✅

- [x] Add `jest-expo`, `jest`, `@types/jest`; `pnpm test` / `pnpm test:watch`; jest config in `package.json`
- [x] Install `@react-native/jest-preset` — an **undeclared peer** jest-expo needs (3rd occurrence of this pattern)
- [x] `lib/harness.test.ts` smoke test, importing `@jest/globals` explicitly
- **Test:** `pnpm test` → 1 passed. `tsc`, ESLint, Prettier all clean.

### T1 — Decoder: types + URI ✅

- [x] `lib/ndef.ts` — `NdefView` discriminated union, `TNF` / `RTD` constants
- [x] 36-entry URI prefix table + `decodeUriPayload()`, reserved index `≥0x24` → no prefix
- [x] `bytesToUtf8()` hand-rolled — `String.fromCodePoint`, U+FFFD on malformed input
- [x] `bytesToHex()`, `typeToString()` (bytes on Android, string on iOS)
- [x] **Verified the library's emoji bug**: `util.bytesToString` yields U+F600 for U+1F600
- **Test:** 9 throwaway assertions passed, then deleted — the real suite is T3. `tsc`, ESLint,
  Prettier clean.

### T2 — Decoder: everything else ✅

- [x] `decodeTextPayload()` — status byte: UTF-8/UTF-16 flag (bit 7) + language length (bits 5–0);
      **keeps the language code** the library discards; clamps a malformed length
- [x] `bytesToUtf16()` — BOM detection, big-endian default, explicit surrogate pairing
- [x] `decodeRecord()` — TNF dispatch: Empty, URI, Text, MIME, Absolute URI, AAR, unknown
- [x] `decodeMessage(records | undefined)` — absent and empty behave identically
- [x] `describeView()`, `kindLabel()`, `summarise()`
- **Test:** 18 throwaway assertions passed, then deleted — real suite is T3. `tsc`, ESLint,
  Prettier clean. `lib/ndef.ts` is 503 lines.

### T3 — Decoder tests ✅

- [x] `lib/ndef.test.ts` — **60 tests**, three groups
- [x] **Correctness:** UTF-8 (2/3/4-byte, truncated, stray continuation), UTF-16 (BOM both ways,
      surrogate pairs, lone surrogate), URI prefixes, text status byte, full TNF dispatch
- [x] **Agreement:** 12 URIs round-tripped through the library's encoder, plus all 36 prefix
      indices — our output matches `ndef-uri.decodePayload` exactly
- [x] **Divergence:** 4 characterisation tests pinning the dropped language code, the U+1F600 →
      U+F600 truncation, the ignored UTF-16 flag, and that 3-byte sequences are unaffected
- [x] Library decoders imported from `ndef-lib/*` directly — dependency-free CommonJS, so the
      tests never touch `NativeModules`
- **Test:** `pnpm test` → 60 passed in 0.7s, no device.

### T4 — Platform-aware tag facts ✅

- [x] `lib/tagFacts.ts` — `Fact = { label, value, unavailable?, footnote? }`; `value: null` is a
      first-class third state, distinct from a value and from zero
- [x] `RawTag` widens `TagEvent` with the undeclared `tech` / `isWritable` fields, once, so the
      screens carry no casts
- [x] Capacity row: `144 bytes` on Android, "CoreNFC does not expose tag capacity" + the Phase 4
      footnote on iOS. The row is **kept** when empty — its absence is the finding
- [x] `formatUid()` — `04C4FC91DF2A81` → `04:C4:FC:91:DF:2A:81`
- [x] Takes the OS as an argument rather than importing `Platform`, so it stays device-free
- [x] `lib/tagFacts.test.ts` — 14 tests. iOS fixture is the **real** observed tag; the Android
      fixture is **constructed and labelled as such** (H2 still open)
- **Test:** `pnpm test` → 74 passed across 3 suites.

### T5 — Error mapper ✅

- [x] **`lib/scanError.ts`, not `lib/nfc.ts`** — deviation from the design: `lib/nfc.ts` cannot be
      imported in tests (the package root builds a `NativeEventEmitter` at load and throws), so the
      mapper lives in its own module that imports only `src/NfcError`
- [x] `toScanError()` → `{ kind, title, detail, developer, provisional }`; 8 kinds, 10 classes
- [x] `isCancellation()` — its own function because it changes behaviour, not wording
- [x] `provisional: true` on everything except `cancelled`, the only kind observed on hardware
- [x] `instanceof` for classification, hardcoded class names for display — `constructor.name` does
      not survive minification
- [x] `types/react-native-nfc-manager-internal.d.ts` — declarations for the deep import
- [x] `lib/scanError.test.ts` — 23 tests, incl. proof that iOS `NFCError:200` and Android
      `'cancelled'` converge on `UserCancel`, and a minification simulation
- **Test:** `pnpm test` → 97 passed across 4 suites. Device check deferred to T8.

### T6 — Store ✅

- [x] `store/tag.ts` — Zustand: `tag`, `views`, `scannedAt`, `setTag()`, `clear()`, `hasTag()`
- [x] Records decoded **once on write**, not in a selector — a selector would return a fresh array
      each render and invalidate every downstream memo
- [x] Not persisted; scan history stays N4
- [x] `store/tag.test.ts` — 9 tests incl. a stable-reference assertion and the real iOS blank tag
      with no `ndefMessage` key
- **Test:** `pnpm test` → 106 passed across 5 suites. Navigation check lands in T9.

### T7 — Shared components ✅

- [x] `components/Collapsible.tsx` — disclosure section, `accessibilityState={{ expanded }}`,
      no animation on purpose (one less thing to misbehave while photographing screens)
- [x] `components/ErrorCard.tsx` — title + actionable detail, with the raw class name and the
      `provisional` flag behind a collapsed Developer detail
- [x] Both follow the existing convention: NativeWind `className`, `const styles` object at the
      bottom, `dark:` variants throughout
- **Test:** `tsc`, ESLint, Prettier clean; 106 tests still green. Visible in T8/T9.

### T8 — Read screen rewrite ✅ **confirmed on iPhone 2026-09-05**

- [x] Decoded summary card replaces the raw NDEF dump; tappable, pushes `/tag`
- [x] `isCancellation()` early-return — a cancel now paints nothing *by design*, not by accident
- [x] `finally` clears the spinner even on that early return
- [x] `ErrorCard` for everything else; `NO_TAG_DATA` covers `readTagOnce()` resolving null
- [x] Raw JSON removed from Read — it moves to Tag Info in T9
- [x] `app/tag.tsx` stub created here: typed routes derive their union from existing files, so
      `router.push('/tag')` will not typecheck until the file exists
- **Test:** ✅ confirmed on device — decoded summary card and silent cancel both correct.

### T9 — Tag Info route ✅ (pending device confirmation)

- [x] `app/tag.tsx` — Identity (facts incl. the capacity row), Records, collapsed Raw JSON
- [x] `FactRow` renders three states, never a silent blank: value · "Not reported" + why · footnote
- [x] Per-record card: decoded value, `kindLabel`, and a collapsed **Bytes** section
- [x] AAR records carry an inline note that Android launches the app and iOS ignores the record
- [x] "No tag scanned yet" empty state for a cold open or a fast refresh
- [x] Title set via `<Stack.Screen options>` in the route itself — expo-router file routing needs
      no registration in the root layout
- **Test:** ⏳ **needs you** — tap the summary card, check the capacity row, then back.

### T10 — Verification sweep ✅

| Check | Result |
| ----- | ------ |
| `tsc --noEmit` | ✅ no type errors |
| ESLint | ✅ clean |
| Prettier | ✅ all matched files |
| `pnpm test` | ✅ 106 passed, 5 suites, 0.66s |
| `expo export` android | ✅ 3.8 MB Hermes bytecode |
| `expo export` ios | ✅ 3.6 MB Hermes bytecode |
| `expo-doctor` | ⚠️ **20/21** — see below |

- [x] The single doctor failure is the upstream patch drift (`expo` 57.0.15 → ~57.0.20,
      `react-native` 0.86.2 → 0.86.3, 9 siblings). **None of Phase 2's additions appear in that
      list** — it was already failing before this phase began. T13 clears it deliberately.
- [x] `dist/` removed after the export; it is gitignored anyway.

### T11 — Documentation ✅

- [x] DEVLOG **§2.1–2.9** (~270 lines): the hand-roll decision, both byte-layout diagrams, the
      three library defects with the CLI transcript, tests-as-argument, the third undeclared peer,
      the `"types": ["jest"]` trap, where the error mapper had to live and why, and the capacity
      row as the Phase 4 argument
- [x] PLATFORM-NOTES: **record-type table** (AAR is Android-only; `type` is bytes on Android and a
      string on iOS) and a **scan-error matrix** marking exactly one row observed and the rest
      provisional, incl. `nfc-off` being unreachable by construction on iOS
- [x] README: Phases 1 and 2 ticked; `pnpm test` added to the scripts table
- **Test:** `pnpm lint` clean. DEVLOG 1426 lines, PLATFORM-NOTES 298.

### T12 — Commit

- [ ] Phase 2 commit message (Phase 1 commits first — still uncommitted)

### T13 — SDK 57 patch catch-up (deliberate, deferred)

- [ ] `expo` 57.0.15 → ~57.0.20 and 10 siblings incl. `react-native` 0.86.2 → 0.86.3
- [ ] Must be followed by `rm ios/Podfile.lock && cd ios && pod install` (DEVLOG §0.10)
- **Do it after Phase 2 lands and before the Android build**, never mid-phase — `expo-doctor`
  currently reports 1 check failed / 11 packages out of date purely because of this drift.

---

## Blocked on hardware

| ID  | Item                                                          | Needs                     |
| --- | ------------------------------------------------------------- | ------------------------- |
| H1  | Confirm the `not-ndef` error shape                            | A genuinely unformatted tag |
| H2  | Android read of the same chip → real `maxSize`, `techTypes`   | An Android device         |
| H3  | Confirm Android cancel maps to `UserCancel` as the source implies | An Android device      |
| H4  | Timeout behaviour on each platform (~60s on iOS)              | Both devices, patience    |

Every Android column in PLATFORM-NOTES stays ⏳ until these are observed. Nothing gets written
down as fact until it has been seen on a device.

---

## Explicitly out of scope for Phase 2

| Item                          | Why                                                            |
| ----------------------------- | -------------------------------------------------------------- |
| Smart Poster (nested records) | Recursive decoder + recursive UI for a type TapCard never writes |
| WiFi handover records         | Same                                                           |
| vCard field parsing           | Phase 3 writes vCards; reading one back is Phase 3's verification loop. Phase 2 shows `text/vcard` as MIME text |
| "Format this tag" button      | Formatting is a **write** — Phase 3, and it touches the safety rules |
| Writing anything at all       | Phase 3                                                        |
| Background tag reading        | Phase 3                                                        |
| Multiple reads per session    | iOS needs explicit session handling; no product need yet       |
| Read-only locking             | Phase 5 — **permanent**, needs a named sacrificial chip        |

## Nice to have — not now, decide later

| ID  | Item                                          | Note                                              |
| --- | --------------------------------------------- | ------------------------------------------------- |
| N1  | Open a decoded URI in the browser (`Linking`) | Cheap and genuinely useful; strongest candidate   |
| N2  | Copy decoded value / raw JSON to clipboard    | Helps *us* capture article data                   |
| N3  | Haptic tick on a successful read              | iOS already gives OS feedback; Android has none — actually a platform-asymmetry beat |
| N4  | Scan history (last N tags)                    | Wants persistence; overlaps Phase 3's storage     |
| N5  | Android antenna-position hint illustration    | Article-friendly, pure UI                         |
| N6  | Share raw JSON out of the app                 | Convenience for writing PLATFORM-NOTES            |
| N7  | Infer manufacturer/chip from the UID prefix (`04` = NXP) | Considered during T4 and left out — it is option 2 from the capacity discussion, i.e. a hardcoded lookup that rots. Revisit alongside Phase 4 |
