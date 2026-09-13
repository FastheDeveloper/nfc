# Gotchas

Every trap this project actually hit, with the symptom first — because that is what you will be
searching for at the time.

Each entry is **what you see** → why → the fix. Nothing here is hypothetical; the chronological
account with full detail is in [`DEVLOG.md`](./DEVLOG.md), and the iOS/Android comparison is in
[`PLATFORM-NOTES.md`](./PLATFORM-NOTES.md).

One convention worth stating: **⛔ marks anything never run on an Android device.** No Android
hardware has been available since Phase 1, so every Android claim here is read from source or from
documentation, and is labelled as such.

---

## Setup and build

- **`create-expo-stack` generates a project pinned to an older Expo SDK than you expect** — 2.23.1
  hardcodes `"expo": "~56.0.4"` in its base template and says so nowhere in its help output. Unpack
  a scaffolder before trusting it: `npm pack create-expo-stack@latest && tar xzf create-expo-stack-*.tgz`,
  then read `package/build/templates/base/package.json.ejs`.

- **`create-expo-module --local --name Foo` does not create `modules/foo`** — `--name` sets the
  _native module_ name. The directory comes from a positional path argument, so without one it
  lands in `modules/my-module`.

- **`expo install --fix` silently skips packages it cannot see** — it only repairs dependencies that
  are both **direct** _and_ in Expo's bundled-version map. Hit three times in this project:
  `@expo/log-box`, `@expo/metro-runtime`, and `@react-native/jest-preset`. The symptom is
  `expo-doctor` continuing to fail after you ran the command it told you to run. Fix: promote the
  package to a direct dependency and pin it by hand.

- **A package required at runtime is not necessarily declared by anything** — `jest-expo` needs
  `@react-native/jest-preset` as an _unmet peer_, so the installer never fetches it and
  `pnpm test` dies at startup. Same disease as above. Third occurrence is a rule, not an anecdote:
  in the Expo ecosystem, check peers before assuming an install is complete.

- **`| tee` makes Expo non-interactive and kills its prompts** — `isTTY` becomes undefined and the
  CLI exits rather than asking. Use `script -q /tmp/log <cmd>` to log while keeping a TTY, or pass
  the flag that avoids the prompt entirely (`--device "Name"`).

- **`npx expo start` exits 1 with `Skipping dev server` if port 8081 is taken** — its
  "use 8082 instead?" prompt has nothing to answer it in a non-interactive shell. Free the port
  first, or pass `--port`.

- **`errno=28` from `libtool` is a full disk, not a build bug** — a React Native iOS build wants
  ~1.5 GB of DerivedData per full rebuild. `~/.gradle/caches` and
  `~/Library/Developer/Xcode/DerivedData` are the safe reclaims; both regenerate.

- **Deleting build caches also deletes `node_modules` if you are not careful** — this project lost
  it across two separate pauses. Harmless with a committed lockfile: `pnpm install` restored 715
  packages in 6 seconds from the content-addressed store, with no downloads.

## Dependencies and the Expo version map

- **A JS-only dependency bump can invalidate `ios/Podfile.lock`** — Expo podspecs read `s.version`
  from their own `package.json`, so bumping `expo` 57.0.14 → 57.0.15 silently desynchronises the
  native lockfile. The symptom is `pod install` failing with
  `could not find compatible versions for pod "ExpoModulesCore"`. Fix:
  `rm ios/Podfile.lock && cd ios && pod install`. **Android never hits this** — Gradle re-resolves
  from `node_modules` every build. "I only touched JS" is not a safe assumption on iOS.

- **CocoaPods names one drifted pod; there may be many** — that error named `ExpoModulesCore`, and
  its suggested `pod update ExpoModulesCore` would have failed thirteen more times. Diff every pod
  before acting: 14 had drifted.

- **`npx expo run:ios` swallows the CocoaPods diagnostic** — it reports a generic
  "Something went wrong running `pod install`". Re-run `pod install` by hand to see the real error.
  There is no Android equivalent, because there is no second resolution step to re-run.

- **Hand-pinning a package to fix one problem creates a maintenance obligation** — both Phase 0
  pins went stale at the next SDK bump. `@expo/log-box` became a _duplicate install_ (ours at top
  level, Expo's nested) — the exact hazard the pin existed to avoid, from the other direction.

- **Take SDK patch bumps at a deliberate moment, never mid-phase** — they invalidate
  `Podfile.lock` and force a full native rebuild. Doing it immediately before a hardware test is
  how you spend an afternoon on three failed builds.

## iOS entitlements and signing

- **`Provisioning Profile "iOS Team Provisioning Profile: *" does not support the NFC Tag Reading
capability`** — Apple forbids special capabilities on a _wildcard_ App ID, and Xcode falls back
  to one silently. Fix: register an **explicit** App ID in the developer portal with NFC Tag
  Reading ticked; Xcode then generates the right profile itself. Note the error blames your local
  entitlements file when the missing half is on Apple's servers.

- **A `Build input file cannot be found: …a33f753b….mobileprovision` alongside it is a red herring**
  — a stale Xcode cache reference to a profile that appears nowhere in your project. Its suggested
  "declare as a script phase output" fix solves nothing.

- **App IDs are globally unique across all Apple accounts, not per-team** — `com.tapcard.app` was
  simply taken. Budget a rename; with CNG it is two lines of JSON and one `prebuild --clean`,
  including the regenerated Kotlin source tree.

- **`plutil -extract` treats dots as key-path separators** — extracting
  `com.apple.developer.nfc.readersession.formats` reports "missing" for a key that is plainly
  there, because it is looking for nested keys named `com`, `apple`, `developer`. Extract the whole
  `Entitlements` dict instead.

- **`Missing required entitlement` at runtime can be one polling option** — `NFCTagReaderSession`
  opened with `.iso18092` (FeliCa) additionally requires
  `com.apple.developer.nfc.readersession.felica.systemcodes`. Without it **the entire session fails
  to start**, not just that mode, and the error never says "FeliCa". iOS gates entitlements per
  polling option; Android's single `android.permission.NFC` covers everything the adapter can do.
  Ask only for what you can sign for.

- **A development certificate can vanish from your keychain and the error will not say so plainly**
  — `No "iOS Development" signing certificate matching team ID …`. Check what you actually have:
  `security find-identity -v -p codesigning`, then read each cert's `OU` (that is the Team ID) with
  `security find-certificate -c "<name>" -p | openssl x509 -noout -subject -enddate`. A
  _Distribution_ certificate for the right team does not satisfy a development build.

## Reading tags

- **There is no simulator path for NFC on either platform.** Not a limitation to design around — it
  is the defining constraint of the work. Everything is tested on hardware, and `Device.isDevice`
  is worth surfacing in the UI so the app keeps answering "is this real hardware?".

- **The iOS scan sheet does _not_ show `NFCReaderUsageDescription`** — it shows the `alertMessage`
  you pass to each `requestTechnology()` call. The usage description is a privacy-manifest string
  that is mandatory (no session starts without it) and never user-facing. Two strings, two sources,
  and easy to conflate until you hold a phone. It also means the sheet copy **can and should differ
  between reading and writing**.

- **The antenna is in a different place on each platform** — top edge on iPhone, near the camera;
  centre-back on Android. "Hold the tag near the phone" is not actionable, and someone using the
  wrong end concludes the app is broken.

- **A blank, NDEF-formatted tag is a success, not a failure** — but `readNDEF` on iOS reports it as
  an _error_ rather than an empty message. Distinguish by the NDEF **status**, not the read error:
  a readable-but-empty tag is `.readWrite`, never `.notSupported`. Factory-fresh NTAG213s are
  exactly this case, so it is the first thing you will hit.

- **iOS's `getTag()` returns two fields: `{ id, tech }`** — no `maxSize`, no `techTypes`, no `type`.
  Not nulls; the keys are absent. ⛔ Android reports all of them from an ordinary read.

- **But that does NOT mean iOS cannot report them.** This project concluded it did, said so in three
  documents, and was wrong. `ndefHandler.getNdefStatus()` → CoreNFC's `queryNDEFStatus` returns both
  a read/write status and a real capacity, inside the session `requestTechnology` already opens.
  **The observation was right; the inference was not.** One API's silence is not a platform
  limitation.

- **`TagEvent.ndefMessage` is typed as required and can be absent** — a blank tag on iOS comes back
  with no such key. Any decoder must treat "absent" and "empty" identically.

- **A record's `type` is bytes on Android and sometimes a string on iOS** — and a `number[]` never
  equals `'U'`, so a naive comparison does not error. It silently falls through to "unknown record".
  Normalise before comparing.

## Writing tags

- **Ask the tag before writing to it.** `queryNDEFStatus` (iOS) / `Ndef.isWritable` + `getMaxSize()`
  (⛔ Android) tell you whether it is locked and how big it really is. A refusal _before_ the write
  leaves the tag untouched; a failure _during_ one can leave it half-written.

- **Never throw a dependency's error type from your own logic.** A pre-flight refusal that threw the
  library's own `TagSizeTooSmall` was indistinguishable from CoreNFC throwing it — which erased the
  one piece of information needed to answer whether the platform had reported a capacity at all.
  Use your own type, carrying the tag's actual numbers.

- **The capacity you want is the maximum NDEF _message_, not the chip's user memory** — an NTAG213
  has 144 bytes of user memory and reports **137**. Using 144 is wrong in the dangerous direction:
  it tells someone their card fits when it does not.

- **Do not add TLV framing to a message and compare against user memory** — that double-counts.
  Every capacity figure in play (Android's `getMaxSize()`, iOS's `queryNDEFStatus`, a sensible
  assumption) is already a _message_ size with the framing excluded. The framing itself is
  `03 <length> <message…> FE` — 3 bytes, or 5 once the length needs 16 bits — and is worth showing
  a user without counting it twice.

- **Verify by reading back, and compare record _content_, not raw bytes** — a tag may legally return
  a message whose framing differs from what you sent (short vs long record form) while carrying
  identical data. Byte comparison produces false mismatches.

- **Do all of it in one session** — on iOS every `requestTechnology` puts a system sheet in front of
  the user, so querying, writing and verifying separately means three sheets and three taps for one
  logical action. ⛔ Android would not notice the difference.

- **A realistic vCard does not fit on an NTAG213** — 213 bytes of NDEF message against 137 available.
  A URL record is 20. That gap is a product decision, not a bug: self-contained and too big, versus
  tiny and dependent on something answering at the other end.

## NDEF and text encoding

- **`'\;'` in a JavaScript string literal is `';'`** — an unknown escape silently drops the
  backslash, so a vCard escaper written that way escapes nothing. This project shipped that bug,
  then wrote a _test_ asserting the unescaped result, then wrote a third test using
  `not.toContain('N:')` — which can never pass, because `BEGIN:VCARD` contains `N:`. Three mistakes,
  one misunderstanding. **Test-first would not have helped: the test and the code shared the
  assumption.**

- **vCard line folding is measured in octets, not characters** — `line.slice(0, 75)` splits a
  multi-byte character down the middle and produces invalid UTF-8. Walk by code point, tracking byte
  cost.

- **vCard 3.0 requires the structured `N` field and it cannot be derived reliably** — splitting a
  display name into family/given is wrong for Chinese and Hungarian names, for Spanish names with
  two surnames, and for anyone with one name. Emit a documented guess and rely on `FN`, which is
  what importers actually display, to carry the name exactly as typed.

- **Pick the _longest_ matching URI prefix, not the first** — `https://` (index `0x04`) matches
  `https://www.example.com`, but `https://www.` (`0x02`) also matches and saves four more bytes.

- **Reserved URI prefix indices (`≥ 0x24`) mean "no prefix", not "error".**

- **`String.fromCharCode` truncates above U+FFFF** — U+1F600 becomes U+F600, an invisible Private
  Use Area character. Use `String.fromCodePoint`. Three-byte sequences (Arabic, CJK) are unaffected,
  so the bug hides until someone uses an emoji.

- **`TextDecoder` is not guaranteed under Hermes** — hand-roll UTF-8/UTF-16 decoding, or verify it
  exists on your runtime.

- **NDEF Text records carry a language code and an encoding flag in one status byte** — bit 7 is
  UTF-8 vs UTF-16, bits 5–0 are the language code's length. `react-native-nfc-manager` reads that
  length, uses it to skip the code, and discards the code itself; its UTF-16 handling is an open
  `TODO`. If you need either, you need your own decoder.

- **An empty NDEF message is a single empty record (`d0 00 00`), not zero bytes** — that is how NDEF
  spells "formatted and deliberately blank", which is what a factory-fresh tag holds.

## Writing your own native module

- **Adding a _file_ to a local Expo module needs `pod install`; adding a _function_ does not** —
  CocoaPods resolves the podspec's `source_files` glob at install time, so a new `.swift` file is
  not in the Xcode target at all. The symptom is `cannot find 'YourClass' in scope` for a file that
  is plainly on disk.

- **A local module's generated podspec may declare a higher iOS deployment target than your app** —
  check before it silently raises your minimum.

- **The CoreNFC session must be retained by the module, not the function** — a local variable is
  deallocated when the function returns, taking the session with it, and **the system sheet vanishes
  with no error at all.** The single easiest way to get a CoreNFC integration subtly wrong.

- **A successful read also invalidates the session** — so `didInvalidateWithError` fires _after_
  completion and will overwrite your result unless settling is guarded. A JavaScript promise must
  settle exactly once; with four nested async steps and five failure paths, that has to be enforced
  rather than assumed.

- **Expo wraps your native exception** — `err.message` in JavaScript is
  `Calling the 'foo' function has failed`, the framework describing its own plumbing. Your sentence
  is at the end of the cause chain, after `→ Caused by:`.

- **Expo's error _code_ is not your class name.** It derives one: strip a trailing
  `Error`/`Exception`, split camelCase, upper-case, prefix `ERR_`. So `UserCancelledException`
  arrives as **`ERR_USER_CANCELLED`**
  (`expo-modules-core/ios/Core/Exceptions/CodedError.swift:45`). Key a lookup table on one and match
  on the other and everything falls through to a generic error — with **272 passing tests saying
  nothing**, because every fixture was handwritten without a `code` property. A fixture you invented
  can only prove your code is self-consistent.

- **⛔ Android reader mode is not a session** — `enableReaderMode` binds a callback to the
  foreground **Activity** (not a Context), fires on every tag, never stops on its own, and delivers
  on a binder thread. `disableReaderMode` must be called on every exit path, and **cancelling is
  entirely the app's problem** — there is no system sheet to provide it.

- **⛔ Pass `FLAG_READER_NO_PLATFORM_SOUNDS`** or the OS plays its own discovery sound over an app
  that is already telling the user what to do.

- **Regenerate `android/` after adding a local module** — autolinking only sees modules that existed
  when the native project was generated. The symptom is Gradle reporting `project not found` for a
  module that is plainly in `modules/`.

## Removing a dependency

- **Check what its config plugin was doing for you first.** `react-native-nfc-manager` generated the
  iOS NFC entitlement and `NFCReaderUsageDescription`. Removing the package removes the plugin,
  which removes both — and **the app loses NFC with no error at all.** Nothing fails at build time;
  the sheet simply never appears again. Declare them yourself in `app.json`
  (`ios.entitlements`, `ios.infoPlist`), prebuild, verify the output is byte-identical, and only
  then delete anything. The code a dependency exports is the visible half.

- **Deleting the package deletes your evidence too** — the tests proving _why_ you replaced it stop
  running, and any "we match the library exactly" agreement tests go with them, leaving hand-typed
  tables unverified. Vendor a frozen copy with its licence, import it from nothing but tests, and
  exclude it from ESLint and Prettier: its value is being wrong in documented ways, so reformatting
  it destroys the thing it demonstrates.

## Tooling

- **Bare `ios` and `android` in `.gitignore` match at any depth** — which silently excluded
  `modules/nfc-native/{ios,android}`, i.e. every line of hand-written Swift and Kotlin. Committing
  would have shipped the TypeScript and left the native module out. Anchor them: `/ios`, `/android`.
  Caught by `expo-doctor`, not by git. And anchoring is only half of it — local module _build_
  output then needs its own rule (`modules/*/android/build/`), or a 247 MB APK tree lands in the
  repo.

- **`@types/jest` installed and `tsc` still cannot find `describe`** — the fix that looks obvious,
  `"types": ["jest"]` in `tsconfig.json`, _replaces_ TypeScript's automatic `@types` discovery
  rather than adding to it, so you then have to enumerate `react` and `node` by hand forever.
  Import the globals in test files instead: `import { describe, expect, it } from '@jest/globals'`.

- **AsyncStorage throws `NativeModule: AsyncStorage is null` under Jest** — it ships an in-memory
  mock; wire it in a setup file. Contrast with a library whose _error classes_ you can import
  around: AsyncStorage **is** the native side and has to be replaced.

- **`react-native-nfc-manager`'s package root throws outside a native runtime** — it builds a
  `NativeEventEmitter` at module load, so anything importing it is untestable without heavy
  mocking. Its error classes live in `src/NfcError`, which depends only on `Platform` and imports
  cleanly. A deep import needs a hand-written `.d.ts`, which `tsc` will catch and Jest will not.

- **Jest passing does not mean `tsc` passes.** A suite went green while the type checker was failing
  on the same file. Run both.

- **`expo-doctor` catches things git and the compiler do not** — the `.gitignore` bug above was
  found by `expo-doctor`, not by any test, not by TypeScript, and not by a code review.
