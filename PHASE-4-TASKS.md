# Phase 4 — Our own native module

Working state, not article material. DEVLOG.md and PLATFORM-NOTES.md are the deliverables.

**Status:** ✅ **Phase 4 complete on iOS** — T0–T2, T4, T5, T7–T11 all confirmed on device. T3/T6 deferred to an Android device. T12 (commit) handed over. 2026-09-13

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
- **Test:** ✅ **confirmed on iPhone 2026-09-13** — native read returns the tag, its status and its real capacity.

### T2a — Adding a Swift file needs `pod install`

The build failed with `cannot find 'NfcReadSession' in scope`. The podspec globs
`**/*.{h,m,mm,swift,…}`, but **CocoaPods resolves that glob at install time**, so files created
after the last `pod install` are not in the Xcode target at all.

Adding a *function* to an existing file needs only a rebuild. Adding a *file* needs
`pod install` first. The error says nothing about either.

### T3 — Android read (Kotlin) ⛔ **DEFERRED 2026-09-13**

Fas: *"we will do android later."* No device, and writing Kotlin we cannot run would produce
unverifiable claims — exactly what this project refuses to do. Picked up when a device appears.

- [ ] `NfcAdapter.enableReaderMode`, `Ndef.get(tag)`, foreground lifecycle
- **Test:** ⛔ blocked on H9

### T4 — Status and capacity ✅ **iOS done, via T2**

Folded into the read session rather than built separately — `queryNDEFStatus` has to run inside the
same session anyway, so a second entry point would have meant a second system sheet.

- [x] iOS: `{ status, capacity }` returned by `readTag`, confirmed on device
- [ ] Android: `Ndef.getMaxSize()` / `isWritable` — ⛔ with T3

### T5 — Write ✅ **confirmed on iPhone 2026-09-13**

- [x] `NfcWriteSession.swift` (224 lines) — connect → `queryNDEFStatus` → refuse early → `writeNDEF`
      → read back → invalidate, all in one session
- [x] **Refuses with our own exception type**, carrying the tag's numbers — never CoreNFC's, so
      "we refused" and "the tag refused" stay distinguishable (the §3.3 lesson, at the native layer)
- [x] `NFCNDEFMessage(data:)` parses our bytes **before a tag is involved**, so a malformed message
      fails early and harmlessly — a free check on our own encoder
- [x] Verification compares **record content, not raw bytes**: a tag may legally return different
      framing (short vs long record form) carrying identical data
- [x] Extracted `NfcTagInfo.swift` (tag → bridge conversions) and `NfcReaderErrors` (CoreNFC code
      translation), shared by both sessions — a read and a write disagreeing about what a UID *is*
      would be a horrible bug to chase
- [x] 4 new typed exceptions: read-only, too-small, invalid-message, write-failed
- **Test:** ✅ our encoder → our Swift writer → verified read-back → **and the library's reader
  agrees**. Real parity evidence ahead of T8.

### T6 — Format ⛔ **DEFERRED 2026-09-13**

Not built, and not a stub. Android's `NdefFormatable` is behind H9, and **iOS exposes no formatting
API at all** — `writeNDEF` simply fails on a non-NDEF tag. Writing a half-path for one platform we
cannot test and one that cannot do it would produce exactly the unverifiable claim this project
refuses to make. Revisit with an Android device and an unformatted tag (H10).

### T6 — Format

- [ ] `NdefFormatable` on Android; on iOS establish and document what is actually possible
- **Test:** ⛔ needs an unformatted tag (H1)

### T7 — TypeScript API and typed errors ✅

- [x] `toScanError()` now handles **both** implementations — the library's classes and our module's
      codes — producing the same `ScanError` either way. That is what lets T9 swap them without
      touching a single screen
- [x] Matching on a **code**, not a class: these errors cross the bridge as values, so there is no
      `instanceof` on the far side, and Expo wraps them so the code must be dug out of the cause
      chain first
- [x] Prefers the **native message** when there is one — `TagTooSmallException` carries the tag's
      real numbers, which beats any generic sentence we could write
- [x] `isCancellation()` recognises both, so a cancel is silent regardless of implementation
- [x] `provisional: false` only for the three native mappings actually observed on hardware
- **Test:** `pnpm test` → **244 passed**, 11 suites. 21 new tests, incl. proof that a cancel from
  either implementation produces an identical result.

### T8 — Parity harness ✅ (pending device check)

- [x] `lib/parity.ts` — pure comparison, so the logic tests in Node and only the scanning needs a
      device
- [x] **"Different" is not one outcome.** Five statuses: `same`, `differs`, `native-only`,
      `library-only`, `neither`. Our read reports capacity and writability that the library's read
      does not — that is our module knowing *more*, and scoring it as a mismatch would be
      actively misleading
- [x] `library-only` blocks the swap too: losing information is a real problem even though it is
      not a contradiction
- [x] UID comparison normalises case and separators — those are not differences
- [x] Records compared by **decoded meaning**, not raw bytes
- [x] `app/parity.tsx` — two sequential scans (one CoreNFC session per app), which also proves the
      agreement survives being read at different moments rather than once
- [x] Both scan paths use the **same** `isCancellation` and `toScanError` — T7 doing its job on
      errors from two unrelated implementations
- [x] `lib/parity.test.ts` — 12 tests, incl. the expected real-world case and each failure mode
- **Test:** ✅ **confirmed on iPhone 2026-09-13** — **0 conflicts, 4 fields agreed, 2 reported only
  by our module** (capacity and writable). Exactly the predicted shape: no contradiction anywhere,
  and the only differences are ours knowing more. This is the evidence T9 needed.

### T9 — Switch the app over ✅ (pending device regression)

- [x] `lib/nfcBackend.ts` — the single place the app chooses. **`BACKEND = 'native'`**
- [x] Every screen imports from it; **no screen imports a backend directly** any more. `parity.tsx`
      deliberately still imports both — comparing them is its job
- [x] `startNfc()` is a **no-op** on the native backend rather than a shim pretending to
      initialise: our sessions are self-contained, the library's needed `NfcManager.start()`
- [x] `checkNfcStatus()` on native routes through our module, and `disabled` is unreachable on iOS
      **by construction** (`enabledIsMeaningful`), not merely unlikely
- [x] The Read screen now records a **real capacity on every read** — the Write screen stops
      assuming without needing a write first. The most visible gain from the swap
- [x] A "NFC backend: native" line on the Read tab, so it is never a guess which is live
- [x] ⚠️ `cancelScan()` is a **knowing no-op** on native. iOS cancels via the system sheet, which
      our session handles. **Android is the gap** — it draws no system UI and our module has no
      cancel entry point yet. Lands with T3; documented in the code so it is not found as a mystery
- **Test:** 7 of 8 passed first time. Test 3 (cancel) failed — see T9a.

### T9a — ⚠️ Expo's error code is **not** your class name

Found by the device regression, not by 272 tests: cancelling a scan on the native backend rendered
a red *"Could not read the tag"* card instead of nothing.

- [x] **Cause.** `expo-modules-core/ios/Core/Exceptions/CodedError.swift:45` derives the code from
      the class name — strip the trailing `Exception`, split camelCase, upper-case, prefix `ERR_`.
      So `UserCancelledException` arrives in JavaScript as **`ERR_USER_CANCELLED`**.
      `describeNativeError()` prefers that code, the mapping table was keyed on the class name, the
      lookup missed, and everything fell through to the generic "unknown" card.
- [x] **Why it hid.** T1a only ever used the *message*, which was extracted correctly all along.
      Nothing depended on the **code** until T7 built a table on it — and every T7 test used a
      handcrafted fixture with no `code` property, so they all passed against a fixture that did
      not match reality.
- [x] **Fix.** `describeNativeError()` now returns `className` (from the cause chain) *and* `code`
      (Expo's) separately. `expoCodeFor()` reproduces Expo's algorithm, so the table stays keyed on
      the Swift class names we actually wrote and the `ERR_` forms are **derived** from them —
      one source of truth rather than two lists that drift.
- [x] `isCancellation()` matches both forms.
- [x] 16 new tests, including the **verbatim device error** as a fixture.

**The transferable lesson:** a test fixture you invented can only prove your code is
self-consistent. Both the code and its tests shared one wrong assumption, so 272 green tests said
nothing about it — it took a thumb on a Cancel button.

### T10 — Remove the dependency ✅ (pending final device pass)

**`react-native-nfc-manager` is no longer a dependency.** The app runs entirely on
`modules/nfc-native`.

The riskiest part was not code. The library's **config plugin** was generating the iOS NFC
entitlement and `NFCReaderUsageDescription` — remove the package and the app loses NFC with no
error at all. So that came first: declared explicitly as `ios.entitlements` and `ios.infoPlist` in
`app.json`, prebuilt, and verified **byte-identical** to what the plugin produced *before* anything
was deleted.

- [x] `app.json` owns the entitlement and usage string; plugin removed
- [x] `lib/nfcTypes.ts` — we own `NdefRecord` / `TagEvent` now, with a correction: `ndefMessage` is
      **optional**, because a blank tag on iOS returns no such key (§1.12). The library's own type
      was wrong about its own data
- [x] **`vendor/react-native-nfc-manager/`** — the two broken decoders and the error classes, kept
      as *evidence*, MIT licence included, with a README explaining why a deleted dependency is
      still in the repo and why it must never be "fixed"
- [x] `lib/vendorEvidence.test.ts` — §1.13 and §2.3 as executable assertions. Delete the vendored
      copy and the argument for Phase 4 becomes a claim in a document instead of something a reader
      can run
- [x] ESLint and Prettier both ignore `vendor/` — the code is 1990s-era `var`, and reformatting it
      would destroy the diff against upstream
- [x] Deleted: `lib/nfc.ts`, `lib/writeError.ts`, `lib/parity.ts`, `app/parity.tsx`,
      `components/NativeCapabilities.tsx`, `types/react-native-nfc-manager-internal.d.ts`
- [x] **`lib/writeError.ts` turned out to be dead code** — the JS pre-flight moved into Swift in
      T5, and capacity now arrives on *every read* rather than only via a refusal. A simplification
      the swap paid for
- [x] The `expo-doctor` New-Architecture exclusion is gone: the package it excluded no longer exists
- [x] `pod install` reported `Removing react-native-nfc-manager`; 113 pods, down from 114
- **Test:** ✅ **all 8 steps passed on iPhone 2026-09-13** — read, capacity 137, silent cancel, reported capacity, write, read-back, vCard refusal, profile intact. The app runs entirely on our own native module.

### T11 — Documentation ✅

- [x] DEVLOG **§4.1–4.10** (~250 lines): the motivation that did not survive hardware and how it was
      re-decided; what CoreNFC actually requires (settle once, retain the session); the FeliCa
      entitlement trap; **Expo's code derivation and why 272 tests missed it**; parity as evidence;
      config plugins as the hidden half of a dependency; and what the swap actually bought
- [x] PLATFORM-NOTES **§8** — the platforms seen from inside the native layer rather than through a
      library's choices: session shape, **entitlements gated per polling option**, capacity and
      writability settled, and our errors vs theirs
- [x] README — Phase 4 ticked; the stack line now says **no third-party NFC dependency**

### T12 — Commit

- [x] Message handed over 2026-09-13

---

## Blocked on hardware

| ID  | Item                              | Needs             |
| --- | --------------------------------- | ----------------- |
| H9  | Every Android claim in this phase | An Android device |
| H10 | Format path                       | An unformatted tag |

Plus H1–H8 still open.
