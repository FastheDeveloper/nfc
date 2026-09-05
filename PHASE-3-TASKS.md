# Phase 3 — Profile editor, writing, capacity

Working state, not article material. DEVLOG.md and PLATFORM-NOTES.md are the deliverables.

**Status:** T0–T10 done · **only T11 (commit, yours to run) remains** · 2026-09-05

Legend: `[ ]` not started · `[x]` done · `[⛔]` blocked on hardware

---

## ⚠️ This is the first phase that writes

Every earlier phase only read, and reading cannot alter a tag. From here it can.

- **A write overwrites the tag's contents.** Reversible — write something else — but not undoable.
- **Never lock a tag.** Making a tag read-only is **permanent**. That is Phase 5, and it does not
  happen without a specific chip named as sacrificial first.
- Confirm before writing. No write happens on a single tap.

## Decisions taken into this phase

| Decision       | Choice                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------ |
| Payload        | **Both** URL and vCard; the user picks per write. One profile, two encodings                |
| Capacity       | Compute the exact encoded size, compare against an **assumed 144-byte NTAG213**, label the assumption in the UI |
| Encoder        | Hand-rolled, matching the Phase 2 decoder, cross-checked against `Ndef.encodeMessage`      |
| Test devices   | **iOS only for now.** Android stays ⛔ until a device is available                          |

---

## Tasks

### T0 — Profile model and persistence ✅

- [x] `store/profile.ts` — 7 flat fields; every one costs tag bytes, so no addresses/photo
- [x] Zustand `persist` + AsyncStorage (first use of a Phase 0 dependency), key `tapcard.profile`
- [x] `hasHydrated` — a **correctness guard, not a spinner**: AsyncStorage is async, so a form
      rendered before hydration would save its own empty defaults over the real profile
- [x] `partialize` keeps `hasHydrated` out of storage; `migrate` merges old data onto current
      defaults so a field added later arrives as `''`, never `undefined`
- [x] `jest.setup.js` — AsyncStorage's shipped in-memory mock, since it *is* the native side and
      must be replaced (unlike NFC's error classes, which could be imported around it)
- [x] `store/profile.test.ts` — 12 tests
- **Test:** `pnpm test` → 131 passed. Device check (edit → force-quit → reopen) comes with T5.

### T1 — vCard encoder ✅

- [x] `lib/vcard.ts` — vCard **3.0** (not 4.0: 3.0 is what `text/vcard` means in the wild and both
      OS importers take it without complaint)
- [x] `escapeText()` — backslash **first**, then newlines → `\n`, then `;` and `,`
- [x] `utf8ByteLength()` — what the tag stores, not `String.length`
- [x] `foldLine()` — folds at 75 **octets**, walking by code point so a fold never lands inside a
      multi-byte sequence. Costs 3 bytes per fold; done anyway, since unfolded long lines are out
      of spec and this file is parsed by software we do not control
- [x] `splitName()` — required `N` field, documented as a heuristic that is wrong for much of the
      world; `FN` always carries the name exactly as typed
- [x] Empty fields omitted entirely — a blank `TEL:` can create an empty phone number, and four
      unused properties is a tenth of a 144-byte budget
- [x] ⚠️ **A realistic card is ~200 bytes** — already over the NTAG213 budget. T4/T6 surface that
- **Test:** 9 throwaway assertions passed, then deleted; real suite is T3.

### T2 — NDEF encoder ✅

- [x] `utf8ToBytes()` added to `lib/ndef.ts`, beside its inverse — the two are a pair and T3
      round-trips them
- [x] `lib/ndefEncode.ts` — `uriRecord`, `mimeRecord`, `textRecord`, `encodeMessage`, `encodedSize`
- [x] `compressUri()` picks the **longest** matching prefix, not the first: `https://www.` (0x02)
      beats `https://` (0x04) on `https://www.example.com` and saves four more bytes
- [x] Record header documented flag by flag; **SR** (short record) set for any payload under 256
      bytes, saving 3 of 144 on every write
- [x] An empty message encodes as a single empty record (`d0 00 00`) — how NDEF spells
      "formatted and deliberately blank", which is what a factory-fresh NTAG213 carries
- [x] Verified: byte-for-byte equality with `ndef-lib`'s own `encodeMessage`, and round-trips
      through the Phase 2 decoder for URI, vCard MIME, and text with a language tag **and emoji**
- [x] Sizes: a short URL is **20 bytes**; a modest vCard **137**. The realistic 200-byte card from
      T1 lands around 214 as a record — comfortably over budget
- **Test:** 8 throwaway assertions passed, then deleted; permanent suite is T3.

### T3 — Encoder tests ✅

- [x] `lib/vcard.test.ts` (26) + `lib/ndefEncode.test.ts` (36) → **193 tests total, 9 suites**
- [x] **Round-trip:** URI (with query + fragment), a prefix-less `geo:` URI, a full vCard with its
      CRLFs, text with a language tag and emoji, and **all 35 non-empty prefixes**
- [x] **Agreement:** identical bytes to `ndef-lib`'s own `encodeMessage` across 6 URI schemes
- [x] Header flags asserted bit by bit; SR dropped past 254 bytes and the 4-byte length verified
      by exact message length
- [x] vCard: escape ordering (backslash first), all three newline forms, fold safety at 2- and
      4-byte character boundaries, unfold round-trip, empty-field omission
- [x] **Sizes pinned as tests**, so the article's figures cannot drift silently: URL **20 bytes**,
      realistic vCard **213 bytes**, empty message `d0 00 00`
- **Test:** `pnpm test` → 193 passed in ~1s. `tsc`, ESLint, Prettier clean.

### T4 — Capacity ✅

- [x] `lib/capacity.ts` — `{ messageBytes, tlvBytes, requiredBytes, budget, basis, verdict, headroom }`
- [x] `basis: 'reported' | 'assumed'` rather than a boolean — the copy branches on it, and the
      word "assuming" appears **every time** it is assumed
- [x] `tlvOverhead()` — the tag wraps the message in `03 <len> …message… FE`, so 3 bytes on a short
      message and 5 once the length needs 16 bits. Two percent of the budget; counted
- [x] **Reported and assumed budgets compare different quantities on purpose**: Android's
      `getMaxSize()` is a max *message* size and already accounts for framing, while our NTAG213
      144 is raw *user memory* and does not. Same number against both would be wrong by exactly
      the TLV overhead
- [x] `verdict`: `fits` / `tight` (within the last 10%) / `too-big`. `tight` exists because on an
      assumed budget the assumption itself could be what decides the outcome
- [x] `lib/capacity.test.ts` — 18 tests, incl. the same vCard reaching **opposite verdicts** on an
      assumed 144 versus a reported 504
- [x] Confirmed: URL **23 bytes required, 121 spare, fits**; realistic vCard **216 required,
      72 over, too-big**
- **Test:** `pnpm test` → 211 passed, 10 suites.

### T5 — Profile editor ✅ **confirmed on iPhone 2026-09-05**

- [x] `app/(tabs)/profile.tsx` — 7 fields, saved on every keystroke, no Save button
- [x] **Hydration gate**: the form does not render until AsyncStorage answers, so it cannot write
      its own empty defaults over a saved card on a cold launch
- [x] Live vCard size at the top — this is the screen where the size *changes*, so a field that
      pushes the card over budget says so while you type it
- [x] Per-field keyboard types and capitalisation (`phone-pad`, `email-address`, `url`, none of
      which should autocorrect)
- [x] `KeyboardAvoidingView` + `keyboardShouldPersistTaps="handled"`
- [x] Clear card is **two taps**, not a system alert — a modal blocks the JS thread and nothing
      here warrants interrupting the app
- **Test:** ✅ confirmed on device.
- ⚠️ Needed a **native rebuild** first: `expo-clipboard` / `expo-haptics` were installed *after*
  T13's `pod install`, so the binary lacked them → `Cannot find native module 'ExpoClipboard'`.
  Fixed with `pod install` + `expo run:ios --device "Fas"`. **A new JS dep reloads; a new native
  dep needs a rebuild.**

### T6 — Write screen ✅ (pending device confirmation)

- [x] `app/(tabs)/write.tsx` — URL/vCard segments, each showing **its own byte count** so the
      comparison is visible without switching
- [x] Capacity card: green / amber / red by verdict, with the assumption restated every render
- [x] "Exactly what goes on the tag" — the literal URL or the full vCard text, plus a byte
      breakdown (message · TLV framing · total · budget)
- [x] URL preview explains the prefix compression and how many bytes the table saved
- [x] Empty-profile and missing-link states both route the user somewhere useful
- [x] **Write button deliberately disabled** — the button that alters a physical object ships with
      its error handling and read-back, not before
- **Test:** ⏳ **needs you** — toggle URL vs vCard and watch the verdict flip.

### T7 — The write itself ✅ (pending hardware)

- [x] `writeNdef()` — one session: query status → refuse early → write → read back → release
- [x] **`ndefHandler.getNdefStatus()` queries the tag first.** Refusing *before* a write leaves the
      tag untouched; failing *during* one can leave it half-written
- [x] `lib/scanError.ts` +4 classes → 3 new kinds: `read-only`, `too-big-for-tag`, `write-failed`
- [x] Cancel is silent here too, same as Read
- [x] Nothing in this project calls `makeReadOnly`
- **Test:** ✅ URL written, verified, read back and opened on device.

### T7a — ⚠️ CORRECTION: iOS *does* report capacity — **CONFIRMED ON HARDWARE**

- [x] `ndefHandler.getNdefStatus()` → `queryNDEFStatusWithCompletionHandler`, which returns
      `(NFCNDEFStatus status, NSUInteger capacity)` — `ios/NfcManager.m:539`
- [x] It needs an `NFCTagReaderSession`, which is exactly what `requestTechnology` opens
      (`ios/NfcManager.m:295`)
- [x] **What was actually observed in Phase 1 stays true:** `getTag()` returns only `{id, tech}`.
      The wrong step was generalising one API's silence to the whole platform
- [x] **Observed 2026-09-05, iPhone "Fas", real NTAG213:**
      `WritePreflightError: too-big · tag reported status 2, 137 bytes · needed 202 bytes`
- [x] `status 2` = ReadWrite, so **writability is knowable on iOS too**
- [x] **137, not 144.** The assumption was wrong a second way: 144 is raw *user memory*, while the
      number that matters is the maximum NDEF *message*. We were 7 bytes too generous
- [x] `lib/capacity.ts` rebuilt on the measurement: `NTAG213_NDEF_BYTES = 137`; TLV framing is now
      **informational only**, never added — every budget in play is already a message size, so
      adding it was double-counting
- [x] `lib/tagFacts.ts` copy corrected — the capacity is missing because of *which call was made*,
      not because the platform cannot answer
- [x] `lib/writeError.ts` — `WritePreflightError` so **our** refusal is never mistaken for the
      tag's. The first version threw the library's own class and made the two indistinguishable,
      which is what blocked this measurement in the first place
- [x] The app now remembers a reported capacity and stops saying "assuming"
- [x] Corrected in T10: DEVLOG §1.12 + §2.8 and the PLATFORM-NOTES capacity rows now carry
      superseded banners — **originals left in place**, because how the mistake was made is the
      transferable part

### T7b — Phase 4's motivation, re-decided 2026-09-05

The capacity finding removed Phase 4's newest argument. Fas re-scoped it rather than dropping it,
and the new framing is more durable because it does not depend on a platform limitation:

**Phase 4 is about owning the native layer, not about a gap in it.** Some teams cannot take a
third-party dependency at all — internal-only policies, audit requirements, or simply a package
they cannot get a fix merged into. The article shows how you would build the thing yourself.

The evidence is already gathered and it is *ours*, not asserted: three defects found by reading
`react-native-nfc-manager` (dropped language code, ignored UTF-16 flag, emoji truncated to U+F600),
plus invalid TypeScript in its `index.d.ts` and a package root that throws outside a native
runtime. That is a concrete answer to "why would I write my own?".

Surviving asymmetry arguments, unaffected by today: `isNfcEnabled()` is unreachable by
construction on iOS, there is no settings deep-link on iOS, and the library is a legacy bridge
module running through RN's interop layer.

### T8 — Read back after write ✅ (pending hardware)

- [x] Re-reads inside the **same** session — separate sessions would mean a second system sheet
      and a second tap on iOS for one logical action
- [x] Re-encodes the records that come back and compares byte for byte
- [x] A mismatch is **reported, never thrown**: the write did succeed, and "it worked but I could
      not confirm it" is more honest than either silence or a failure
- **Test:** ✅ URL write verified on device; read back on the Read tab and the link opened.

### T9 — Verification sweep ✅

| Check | Result |
| ----- | ------ |
| `tsc --noEmit` | ✅ clean |
| ESLint + Prettier | ✅ clean |
| `pnpm test` | ✅ **215 passed**, 10 suites |
| `expo export` | ✅ android 3.9 MB · ios 3.7 MB |
| `expo-doctor` | ✅ **21/21** |

### T10 — Documentation ✅

- [x] DEVLOG **§3.1–3.9** (~280 lines): the capacity correction and *how the reasoning failed*, the
      137-vs-144 double error, the error type that hid the finding, the one-session write flow,
      three escaping mistakes in a row, the numbers, the hydration guard, and Phase 4's re-scope
- [x] DEVLOG §1.12 and §2.8: superseded banners, originals intact
- [x] PLATFORM-NOTES: a new corrected section leading §5, with the read-vs-write-session table —
      **the real asymmetry is that Android volunteers this on a read while iOS makes you ask
      inside a session**, not that iOS cannot answer
- [x] README: Phase 3 ticked; Phase 4 relabelled "owning the native layer"

### T11 — Commit

- [ ] Commit message handed over (never run by me) — **Phase 3 + the earlier follow-ups batch**

---

## Blocked on hardware

| ID  | Item                                            | Needs                        |
| --- | ----------------------------------------------- | ---------------------------- |
| H5  | Any write at all, verified by reading back      | A chip — **iOS is enough**   |
| H6  | Write-error shapes (too small, not writable)    | A chip, ideally a full one   |
| H7  | Everything Android in this phase                | An Android device            |
| H8  | Whether a written vCard is offered as a contact by iOS | A chip               |

Plus H1–H4 still open from Phase 2.

## Explicitly out of scope

| Item                        | Why                                                          |
| --------------------------- | ------------------------------------------------------------ |
| Locking a tag read-only     | **Permanent.** Phase 5, with a named sacrificial chip        |
| vCard PHOTO                 | Base64 photo blows a 144-byte budget by an order of magnitude |
| Multi-record messages       | One record per write until there is a reason for more        |
| Hosting for the URL option  | README says there is no backend; the URL is user-supplied     |
| Background tag reading      | Still Phase 3-adjacent but separate; keep the write path clean |
| Formatting an unformatted tag | Depends on H1, which is unobserved                          |
