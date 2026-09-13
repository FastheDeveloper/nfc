# Phase 4 — Our own native module

Working state, not article material. DEVLOG.md and PLATFORM-NOTES.md are the deliverables.

**Status:** T0–T1 confirmed · T2 built, building for device · started 2026-09-05

Legend: `[ ]` not started · `[x]` done · `[⛔]` blocked on hardware

---

## What this phase is for

**Owning the native layer, not filling a gap in it.** The capacity finding (DEVLOG §3.1) removed
the "iOS can't do X" argument, and this is the better one anyway: plenty of teams cannot take a
third-party dependency at all — internal-only policies, audit requirements, or a package they
cannot get a fix merged into on any useful timescale.

The evidence is already ours rather than asserted:

| Found by reading `react-native-nfc-manager` | Where |
| ------------------------------------------- | ----- |
| Text decoder discards the language code      | §2.3  |
| UTF-16 flag ignored — an open `TODO`         | §2.3  |
| Emoji truncated to U+F600 by `fromCharCode`  | §2.3  |
| `index.d.ts` is invalid TypeScript           | §1.2  |
| Package root throws outside a native runtime | §2.7  |
| Errors carry meaning in the class, message always `''` | §1.13 |

**Decision: full replacement.** Read, write, status and format, both platforms, then the
dependency comes out.

## The rule that keeps this safe

**The module grows alongside the library. Nothing is removed until parity is proven.**

The app has 215 passing tests and a verified write on hardware. That stays true throughout. The
switch happens once — at T9 — behind a flag, and the dependency is deleted at T10 only after the
same tests pass against our implementation.

## Constraints

- **iOS is testable, Android is not** — no device. Kotlin can be *compiled* (`assembleDebug`)
  without one, which catches most of what a type checker would. It cannot be *run*. Every Android
  claim stays ⛔ until that changes.
- **The JS layer stays.** `lib/ndef.ts`, `lib/vcard.ts`, `lib/ndefEncode.ts`, `lib/capacity.ts`
  are ours already and are better than the library's equivalents. This phase replaces the
  **native bridge**, not the decoding.

---

## Tasks

### T0 — Scaffold ✅

- [x] `create-expo-module@latest --local --name NfcNative --package com.nfccard.tap.nfcnative
      -p apple android --features Function`
- [x] Scaffolded into `modules/my-module` — the directory name comes from a **positional path
      argument**, not `--name`, so it needed renaming to `modules/nfc-native`
- [x] Podspec declares an iOS **16.4** floor; the app's target is also 16.4 (SDK 57 default), so
      no conflict — worth checking, since a module can raise an app's minimum
- [x] `pod install` autolinked `NfcNative (1.0.0)` with no config plugin and no manual wiring
- **Test:** T0 and T1 verified together — a native rebuild is the expensive step, so one build
  covers both.

### T0a — Note on the toolchain

`--features Function` generated a working module in four files. No Xcode project surgery, no
`RCT_EXPORT_METHOD`, no manual JSI. Worth stating plainly for anyone who last wrote a React Native
native module in the bridge era: **the scaffolding is no longer the hard part.**

### T1 — Capabilities ✅ (pending device confirmation)

- [x] Swift: `isSupported` / `isEnabled` / `canOpenSettings` / `openNfcSettings`
- [x] Kotlin: the same four, over a real `NfcAdapter` — ⛔ compiled shape only, never run
- [x] iOS `openNfcSettings()` **throws `NoNfcSettingsException`** with a real message. Expo's
      `Exception` gives a code *and* a message — the direct contrast with the library's classes,
      which carry meaning in the class and an empty string in `message` (§1.13)
- [x] `lib/nfcCapabilities.ts` adds `enabledIsMeaningful` — the asymmetry as a field, so the UI
      never presents an iOS "enabled" as if it answered the same question as Android's
- [x] NFC permission declared in the **module's own** manifest, so it travels with the code that
      needs it and does not vanish when the library's config plugin is removed in T10
- [x] `components/NativeCapabilities.tsx` renders our answers beside the library's, so any
      disagreement is visible while both exist
- **Test:** ✅ confirmed on device — the typed exception crossed Swift → JS intact.

### T1a — Expo wraps your exception

Observed on device: `openNfcSettings()` rejected with

```
FunctionCallException: Calling the 'openNfcSettings' function has failed
  → Caused by: NoNfcSettingsException: iOS has no NFC setting to open. …
```

- [x] The typed error **works** — code and message both survive the bridge
- [x] But `err.message` is the **framework's** sentence, not ours; ours is at the end of the cause
      chain. Render it naively and a user reads Expo's plumbing
- [x] `lib/nativeError.ts` + 8 tests — `describeNativeError()` returns `{ code, message, chain }`,
      degrading to the full message if Expo ever changes its `Caused by:` separator
- [x] The card now shows our sentence, with the full chain behind a disclosure

**The lesson worth keeping:** this is the mirror image of §1.13. There the message was empty and
the meaning lived in the class; here the meaning is present but buried under a wrapper. Both break
the same reflex — `err.message` — and **owning the native side does not exempt you from error
plumbing, it just changes which layer surprises you.**

### T2 — iOS read session (Swift) ✅ (pending device confirmation)

- [x] `modules/nfc-native/ios/NfcReadSession.swift` (251 lines) — `NFCTagReaderSession`, its
      delegate, and four nested async steps: begin → detect → connect → queryNDEFStatus → readNDEF
- [x] **Settle exactly once**, `NSLock`-guarded. A successful read also invalidates the session, so
      `didInvalidateWithError` fires *after* completion and must not overwrite the result. Get this
      wrong and the app either hangs forever or crashes on a double-resolve
- [x] **The session is retained by the module, not the function.** A local variable would be
      deallocated on return, taking the session with it — the sheet vanishes with no error at all
- [x] `NfcExceptions.swift` — 9 typed exceptions, each with a code *and* a message. CoreNFC's
      `NFCReaderError` codes are mapped, so a user cancel is distinguishable from a timeout
      **without string matching** — the trap §1.13 documents
- [x] A blank-but-formatted tag is not a failure: `readNDEF` errors on one, so the distinction is
      made by `status` rather than by the read error
- [x] `Data` does not cross the bridge — every field becomes `number[]`, which is exactly the
      shape `lib/ndef.ts` already decodes. **The parser is untouched by this phase**
- [x] `lib/nfcNative.ts` returns a `RawTag`, so the store, decoder and Tag Info cannot tell which
      implementation produced it — that is what makes T9's swap provable rather than plausible
- **Test:** ⏳ **needs you** — "Read a tag with our module" on the violet card.

### T2a — Adding a Swift file needs `pod install`

The build failed with `cannot find 'NfcReadSession' in scope`. The podspec globs
`**/*.{h,m,mm,swift,…}`, but **CocoaPods resolves that glob at install time**, so files created
after the last `pod install` are not in the Xcode target at all.

Adding a *function* to an existing file needs only a rebuild. Adding a *file* needs
`pod install` first. The error says nothing about either.

### T3 — Android read (Kotlin)

- [ ] `NfcAdapter.enableReaderMode`, `Ndef.get(tag)`, foreground lifecycle
- **Test:** ⛔ compile only

### T4 — Status and capacity

- [ ] iOS `queryNDEFStatus` → `{ status, capacity }`; Android `Ndef.getMaxSize()` / `isWritable`
- **Test:** must report **137** for our NTAG213s, matching DEVLOG §3.1

### T5 — Write

- [ ] `writeNdefMessage(bytes)` on both platforms, inside the existing session
- **Test:** write a URL, read it back, compare bytes

### T6 — Format

- [ ] `NdefFormatable` on Android; on iOS establish and document what is actually possible
- **Test:** ⛔ needs an unformatted tag (H1)

### T7 — TypeScript API and typed errors

- [ ] One typed surface mirroring what `lib/nfc.ts` exposes today
- [ ] Errors carry a **code and a message**, unlike the library's empty-message classes (§1.13)
- **Test:** `pnpm test` — the mapper's tests point at ours

### T8 — Parity harness

- [ ] Run both implementations against the same tag and diff the results
- [ ] Any divergence is a finding, recorded either way
- **Test:** on hardware, iOS

### T9 — Switch the app over

- [ ] One flag flips `lib/nfc.ts` between implementations
- [ ] Full regression: read, Tag Info, write, verify, capacity, errors, cancel
- **Test:** the whole app on hardware

### T10 — Remove the dependency

- [ ] Delete `react-native-nfc-manager`; keep the divergence tests by pointing them at a vendored
      copy of the two decoders, so §2.3's evidence does not evaporate
- **Test:** `pnpm test`, `expo-doctor`, full app on device

### T11 — Documentation

- [ ] DEVLOG §4.x — the module anatomy, bridging, threading, what the library was hiding
- [ ] PLATFORM-NOTES — native-side asymmetries seen from the inside this time
- [ ] README — tick Phase 4

### T12 — Commit

- [ ] Message handed over (never run by me)

---

## Blocked on hardware

| ID  | Item                              | Needs             |
| --- | --------------------------------- | ----------------- |
| H9  | Every Android claim in this phase | An Android device |
| H10 | Format path                       | An unformatted tag |

Plus H1–H8 still open.
