# Phase 3 — Profile editor, writing, capacity

Working state, not article material. DEVLOG.md and PLATFORM-NOTES.md are the deliverables.

**Status:** T0 done · T1 next · started 2026-09-05

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

### T1 — vCard encoder

- [ ] `lib/vcard.ts` — vCard 3.0: escaping (`,` `;` `\` newlines), CRLF line endings
- [ ] Omit empty fields rather than emitting blank properties
- **Test:** unit tests in T3

### T2 — NDEF encoder

- [ ] `lib/ndefEncode.ts` — build URI and MIME records, then a whole message, as bytes
- [ ] URI prefix compression on write: pick the longest matching prefix from the Phase 2 table
- [ ] `encodedSize()` — the exact byte count that goes on the tag, for the capacity check
- **Test:** unit tests in T3

### T3 — Encoder tests

- [ ] **Round-trip:** encode → decode with the Phase 2 decoder → identical value
- [ ] **Agreement:** our message bytes match `Ndef.encodeMessage()` for the same records
- [ ] vCard escaping, prefix selection, empty-field omission
- **Test:** `pnpm test` — no device needed

### T4 — Capacity

- [ ] `lib/capacity.ts` — `{ bytes, budget, assumed, verdict }`, verdict of fits / tight / too-big
- [ ] The 144-byte NTAG213 figure is a **named assumption**, not a fact, and says so
- **Test:** unit tests; visible in T6

### T5 — Profile editor

- [ ] `app/(tabs)/profile.tsx` — form over the T0 store, saving as you type
- **Test:** type, navigate away, come back

### T6 — Write screen

- [ ] `app/(tabs)/write.tsx` — URL/vCard toggle, live byte count, capacity warning, preview
- [ ] Confirmation step before any write
- **Test:** on the iPhone — the size updates as the profile changes

### T7 — The write itself

- [ ] `writeNdef()` in `lib/nfc.ts` — `requestTechnology` → `writeNdefMessage` → release
- [ ] Extend `lib/scanError.ts` with the write-side classes: `TagNotWritable`, `TagSizeTooSmall`,
      `TagUpdateFailure`, `ZeroLengthMessage`
- **Test:** ⛔ needs a chip — write, then read it back on the Read tab

### T8 — Read back after write

- [ ] Re-read inside the same session and compare against what we sent
- [ ] Report a mismatch rather than assuming success
- **Test:** ⛔ needs a chip

### T9 — Verification sweep

- [ ] `tsc`, ESLint, Prettier, `pnpm test`, `expo export` both platforms, `expo-doctor` 21/21
- **Test:** all green, output in the session

### T10 — Documentation

- [ ] DEVLOG §3.x — vCard escaping, prefix compression on write, the assumed-capacity decision
- [ ] PLATFORM-NOTES §6 — the write-flow table, currently all ⏳
- [ ] README — tick Phase 3
- **Test:** read them

### T11 — Commit

- [ ] Commit message handed over (never run by me)

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
