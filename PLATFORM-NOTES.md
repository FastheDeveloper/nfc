# TapCard — iOS vs Android, side by side

The running comparison that becomes the article's headline section. Filled in
continuously as we hit each difference on real hardware. Nothing in this file is
theoretical — if it is written here, we observed it on a device.

Legend: ✅ works · ⚠️ works with caveats · ❌ not possible on this platform · ⏳ not yet tested

---

## 1. Project setup & first build

|                            | Android                                                                                     | iOS                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain                  | JDK 17 (Zulu 17.0.10) + Android SDK + Gradle                                                | Xcode 26.6 + CocoaPods 1.16.2                                                                                                                  |
| Identity needed            | Package name only (`com.nfccard.tap`) — chosen freely, no registration, no uniqueness check | Bundle ID **registered as a globally-unique App ID** with Apple, plus a team (`V993Z3KD7P`), a signing certificate, and a provisioning profile |
| Cost to get started        | £0                                                                                          | £99/yr — **NFC is not available on a free provisioning profile**                                                                               |
| Device prep                | Enable Developer Options → USB debugging, accept RSA fingerprint prompt                     | Unlock, "Trust This Computer", device registered to the team                                                                                   |
| First build command        | `npx expo run:android`                                                                      | `npx expo run:ios --device`                                                                                                                    |
| Build time (first)         | ⏳                                                                                          | ⏳                                                                                                                                             |
| Build time (incremental)   | ⏳                                                                                          | ⏳                                                                                                                                             |
| Native dependency lockfile | ❌ none — Gradle re-resolves from `node_modules` every build                                | ⚠️ `ios/Podfile.lock`, versioned **separately** from `package.json` and must be re-synced by hand                                              |
| First build attempt        | ✅ booted first try                                                                         | ❌ failed before Xcode ran — `pod install` rejected a stale lockfile                                                                           |
| Build eventually succeeded | ✅                                                                                          | ✅ after clearing `Podfile.lock` (DEVLOG §0.10) and restoring a TTY (§0.11)                                                                    |
| Attempts needed            | 1                                                                                           | 3                                                                                                                                              |

**Observation so far:** the asymmetry starts before a line of code is written. Android
needs a name; iOS needs a _legal identity, a paid subscription, and a capability enabled
in a web portal_. For an NFC article this is the single biggest barrier-to-entry
difference and it deserves to be stated plainly up front.

**Observed 2026-08-22 — the same dependency bump broke iOS and was invisible on Android.**
A routine set of Expo SDK 57 **patch** bumps (`expo` 57.0.14 → 57.0.15 and 13 siblings,
DEVLOG §0.9) changed the version that each Expo `.podspec` reports, because those podspecs
read `s.version` from the package's own `package.json`.

|                            | Android                                        | iOS                                                                          |
| -------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| What we changed            | JS dependencies only                           | JS dependencies only                                                         |
| Native side noticed?       | No — Gradle reads `node_modules` at build time | Yes — `Podfile.lock` still pinned the pre-bump versions                      |
| Result                     | Built and booted normally                      | `[!] CocoaPods could not find compatible versions for pod "ExpoModulesCore"` |
| Pods needing re-resolution | n/a                                            | **14**                                                                       |
| Fix                        | none needed                                    | `rm ios/Podfile.lock && cd ios && pod install`                               |

This is the cleanest illustration we have of a structural difference: **iOS keeps a second
lockfile that can silently fall out of step with `package.json`; Android does not.** On iOS,
"I only touched JS" is not a safe assumption. Note also that `npx expo run:ios` _swallowed_
the CocoaPods diagnostic and printed only a generic "something went wrong" — the fix was
only findable by re-running `pod install` directly, which has no Android equivalent because
there is no second resolution step to re-run.

## 2. Permission & configuration model

|                                         | Android                                                         | iOS                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Mechanism                               | `AndroidManifest.xml` — `<uses-permission>` + `<intent-filter>` | `.entitlements` + `Info.plist` + a capability toggled in the Apple Developer portal                        |
| NFC declaration                         | `android.permission.NFC`                                        | `com.apple.developer.nfc.readersession.formats = [NDEF, TAG]`                                              |
| User-facing prompt                      | **None.** NFC is not a runtime permission                       | **None either.** `NFCReaderUsageDescription` is mandatory but is _not_ shown in the scan sheet — see below |
| Server-side component                   | None                                                            | ✅ App ID must have "NFC Tag Reading" enabled in the portal — a local-only change is not enough            |
| Handled by the library's config plugin? | Permission ✅ / intent-filter ❌                                | Entitlement ✅ / usage string ✅ / portal ❌ (manual)                                                      |

**Corrected 2026-09-05 on hardware.** This table previously claimed the
`NFCReaderUsageDescription` string is "shown in the system NFC sheet". It is not. iOS
sources the sheet's text from the `alertMessage` passed to each `requestTechnology()` call;
the usage description is a privacy-manifest declaration that the scan sheet never displays.

| String                      | Set in                                            | Shown to the user                |
| --------------------------- | ------------------------------------------------- | -------------------------------- |
| `NFCReaderUsageDescription` | `app.json`, via the library's config plugin       | ❌ never in the scan sheet       |
| `alertMessage`              | per call, `requestTechnology()` (`lib/nfc.ts:88`) | ✅ the sheet body, on every scan |

Both are required — a reader session will not start without the usage description — but only
`alertMessage` is user-facing copy, and because it is per-call it **can and should differ
between reading and writing**. Android has no equivalent to either: `alertMessage` is ignored
outright, and there is no usage-description concept at all. See DEVLOG §1.11.

**Confirmed on device, Phase 1 — the entitlement file is necessary but not sufficient on iOS.**
Android's NFC declaration is one line in a generated manifest and it is _done_: no account, no
server, no approval.

|                                       | Android                                                    | iOS                                                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local declaration                     | `<uses-permission android:name="android.permission.NFC"/>` | `com.apple.developer.nfc.readersession.formats = [NDEF, TAG]` in `.entitlements`                                                                                         |
| Added by the library's config plugin? | ✅                                                         | ✅                                                                                                                                                                       |
| Anything else required?               | ❌ nothing                                                 | ✅ an **explicit** App ID with "NFC Tag Reading" enabled in the Apple Developer portal                                                                                   |
| Works with a wildcard App ID?         | n/a                                                        | ❌ **No.** Apple forbids special capabilities on wildcard App IDs                                                                                                        |
| Where the build breaks if you skip it | n/a                                                        | code signing — `xcodebuild` exits 65                                                                                                                                     |
| What the error actually says          | n/a                                                        | `Provisioning Profile "iOS Team Provisioning Profile: *" does not support the NFC Tag Reading capability` — it names the wildcard profile, never the missing portal step |
| Paid membership required              | ❌ no                                                      | ✅ yes — the capability cannot be enabled without one                                                                                                                    |

This bit us in a specific and instructive way. The Phase 0 app requested _no_ entitlements, so
Xcode happily signed it against the team's **wildcard** profile (`533Y5NB8YV.*`) and no App ID was
ever created. Adding the NFC entitlement in Phase 1 invalidates that shortcut: a wildcard profile
can never carry it. Across all 17 provisioning profiles on this machine, `grep`ping for
`nfc.readersession` returns **0**.

So on Android, "add NFC support" is a code change. On iOS it is a code change **plus** a web-portal
change in an account with a paid membership.

**Confirmed on hardware.** Skipping the portal step fails the build at **code signing** with exit
code 65, and the message points at a provisioning profile rather than at the website you actually
need to visit. Registering an explicit App ID with **NFC Tag Reading** ticked, in the team that owns
the bundle ID, unblocks it — Xcode then generates the profile itself. Apple granted
`[NDEF, TAG, PACE]`, a superset of the `[NDEF, TAG]` the entitlements file requests: a profile may
carry more than the app asks for, but never less.

**Also confirmed by inspection** (`npm pack react-native-nfc-manager` → `app.plugin.js`):
the bundled plugin adds the iOS entitlement, `NFCReaderUsageDescription`, and the Android
`NFC` permission — but it does **not** add the Android `NDEF_DISCOVERED` intent filter. We
therefore have to write a small config plugin ourselves for Phase 3's background-tap test.
The iOS equivalent (background tag reading) needs no manifest work at all because it is
handled by the OS. Different shape of problem entirely.

## 3. Scan UX

|                            | Android                                      | iOS                                                                    |
| -------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| Who draws the UI           | We do                                        | **The OS does** — a system NFC sheet we cannot restyle                 |
| Model                      | Foreground dispatch; tag arrives as an event | Session-based: open a session, OS takes over, session returns a result |
| User-visible during scan   | Nothing unless we render it                  | Apple's sheet with our `alertMessage`                                  |
| Cancel                     | We decide                                    | System sheet's Cancel button; app is notified                          |
| Timeout                    | Ours to define                               | Enforced by the OS (~60s)                                              |
| Multiple reads per session | Natural                                      | Requires explicit session handling                                     |
| Sheet copy observed        | n/a — no sheet exists                        | ✅ **"Ready to Scan" / "Hold your iPhone near the NFC tag."**          |
| Success feedback           | ⏳ ours to draw                              | ✅ OS draws its own checkmark before dismissing                        |
| Antenna position           | ⏳ centre-back (to confirm)                  | ✅ **top edge**, near the camera bump                                  |
| Screenshot                 | ⏳ `[SCREENSHOT: Android silent scan]`       | ✅ `[SCREENSHOT: iOS system NFC sheet]` — captured 2026-09-05          |

**Observed 2026-09-05, iPhone 13 Pro / iOS 26.5.** The sheet appearing at all is the
end-to-end proof that the NFC entitlement is live: CoreNFC refuses to present it for an app
whose provisioning profile lacks NFC Tag Reading, which is precisely how this build failed
two weeks earlier (DEVLOG §1.7, §1.9). **On iOS the scan UI doubles as an entitlement test.**
Android has no such signal — nothing is drawn either way, so a misconfigured Android build
looks identical to a working one until a tag is actually presented.

## 4. Background tag behaviour (app closed)

The four-way matrix — record type × platform. All ⏳ until Phase 3 on hardware.

| Tag content                  | Android (app closed) | iOS (app closed) |
| ---------------------------- | -------------------- | ---------------- |
| NDEF URI record → our scheme | ⏳                   | ⏳               |
| NDEF URI record → https URL  | ⏳                   | ⏳               |
| `text/vcard` MIME record     | ⏳                   | ⏳               |
| Empty / unformatted tag      | ⏳                   | ⏳               |

Hypothesis to test, not yet verified: Android's `NDEF_DISCOVERED` intent filter should let
our app claim matching tags outright, whereas iOS background tag reading surfaces a
_notification_ the user must tap, and only for certain record types. Phase 3 records what
actually happens.

## 5. `react-native-nfc-manager` API surface differences

**Same two calls, completely different user experience.** `requestTechnology(NfcTech.Ndef)` then
`getTag()` works on both platforms, which makes the library look platform-agnostic. It is not:

|                           | Android                                                                    | iOS                                                                           |
| ------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Who draws the scanning UI | **The app must.** Foreground dispatch is silent                            | **The OS does** — CoreNFC presents a system modal sheet                       |
| `alertMessage` option     | Ignored                                                                    | Shown as the sheet's text                                                     |
| How the user cancels      | No system affordance — the app must offer a Cancel button                  | Taps Cancel on the system sheet; our JS receives an error                     |
| Underlying model          | Event-ish / reader-mode dispatch                                           | Session-based (`NFCNDEFReaderSession`)                                        |
| `isEnabled()`             | Real native call to `NfcAdapter.isEnabled()`                               | **Hardcoded `return true`** in `src/NfcManagerIOS.js` — no user toggle exists |
| "Open NFC settings"       | `goToNfcSetting()`                                                         | ❌ Does not exist — no such settings screen                                   |
| Module type               | Legacy bridge module (no `codegenConfig`), via TurboModule interop on both | same                                                                          |

Consequence for our code: the scanning state in `app/(tabs)/index.tsx` renders a Cancel button on
Android only, and different waiting copy per platform — because on iOS the user is looking at
Apple's sheet, not our screen.

### ⚠️ Corrected 2026-09-05 — capacity _is_ available on iOS

This section previously concluded that iOS cannot report tag capacity. It can. The correction is
kept visible rather than edited away, because the reasoning error is the transferable part.

|                | What we observed                      | What we wrongly concluded    |
| -------------- | ------------------------------------- | ---------------------------- |
| iOS `getTag()` | returns `{ id, tech }` — no `maxSize` | "iOS cannot report capacity" |

The capability is one call away: `ndefHandler.getNdefStatus()` → CoreNFC's `queryNDEFStatus`
(`ios/NfcManager.m:539`) returns both a status and a capacity, inside the `NFCTagReaderSession`
that `requestTechnology` already opens.

**Observed on hardware, 2026-09-05, NTAG213 on iPhone "Fas": `status 2 (ReadWrite), 137 bytes`.**

| Question | Answered by a **read** (`getTag`)  | Answered during a **write session** (`getNdefStatus`) |
| -------- | ---------------------------------- | ----------------------------------------------------- |
| Tag UID  | ✅                                 | —                                                     |
| Capacity | ❌ iOS · ✅ Android (`maxSize`)    | ✅ **both**                                           |
| Writable | ❌ iOS · ✅ Android (`isWritable`) | ✅ **both** (`status`)                                |

So the real asymmetry is narrower and more interesting than "iOS tells you less": **Android
volunteers this information with an ordinary read, while iOS requires you to ask a specific
question inside a session.** Same data, different price of admission.

Two further corrections that fell out of the measurement:

- **137, not 144.** We had assumed the NTAG213's raw _user memory_. The number that matters is the
  maximum NDEF _message_, smaller by the tag's own bookkeeping — so the assumption was seven bytes
  too generous, in the direction that tells a user their card fits when it does not.
- The capacity model had been adding TLV framing to the message _and_ comparing against user
  memory. Double-counting. Every budget in play is already a message size.

### What `getTag()` actually returns

**Observed 2026-09-05** — same physical NTAG213, read on iOS. The Android column stays ⏳ until
a device is available, and that gap is the entire point of the table.

| Field         | Android           | iOS (observed)                                |
| ------------- | ----------------- | --------------------------------------------- |
| `id`          | ⏳                | ✅ `04C4FC91DF2A81` (7-byte NXP UID)          |
| `tech`        | ⏳                | ✅ `"mifare"` — CoreNFC family classification |
| `techTypes`   | ⏳ expected array | ❌ **key absent**                             |
| `type`        | ⏳ expected       | ❌ **key absent**                             |
| `maxSize`     | ⏳ expected       | ❌ **key absent**                             |
| `ndefMessage` | ⏳                | ✅ empty — tag is NDEF-formatted but blank    |

The full iOS payload is two keys:

```json
{ "id": "04C4FC91DF2A81", "tech": "mifare" }
```

These are not nulls being rendered as `(none)` — the keys do not exist on the object.

> ⚠️ **Superseded** — see the correction at the top of this section. Capacity is available on
> iOS via `getNdefStatus()`, and the real figure is 137, not 144.

**This is the first platform gap in the project to change a product decision rather than a
build step.** The NTAG213 ~144-byte capacity figure that was meant to drive Phase 3's vCard
size warning is simply unavailable on iOS. Phase 3 must choose between an Android-only
warning, a hardcoded UID-prefix → capacity table, or reading the NTAG capability container
directly — the last of which is Phase 4's native-module argument arriving unprompted. See
DEVLOG §1.12.

### User-cancel: a rare symmetry, and a silent trap

|                              | Android                          | iOS (observed)           |
| ---------------------------- | -------------------------------- | ------------------------ |
| What the native side returns | the literal string `'cancelled'` | `NFCError:200`           |
| What JS receives             | `NfcError.UserCancel`            | ✅ `NfcError.UserCancel` |
| `err.message`                | `''`                             | ✅ `''` — **empty**      |
| What our Phase 1 UI showed   | ⏳                               | **nothing at all**       |

Both platforms converge on the same error _class_ by completely different routes
(`NfcError.js:113` and `:141`), so `instanceof NfcError.UserCancel` is genuinely
cross-platform. **One of the few places the library hides a difference instead of leaking
one** — worth saying out loud in a document that is otherwise a catalogue of leaks.

The trap is that all 24 error classes are constructed with no arguments, so `err.message` is
always `''`. The universal JavaScript reflex — render `err.message` — produces an empty
string, which React treats as falsy, so the error renders as **nothing**: no crash, no log,
no empty box. Phase 2 must match on the class and treat `UserCancel` as a non-error rather
than painting a red box at a user who simply changed their mind. See DEVLOG §1.13.

### NDEF record types, and the one that is Android-only

Phase 2's decoder handles these. The format itself is platform-neutral — the _dispatch_ of a
record once read is not.

| Record                                                         | Android                                              | iOS                     |
| -------------------------------------------------------------- | ---------------------------------------------------- | ----------------------- |
| URI (`TNF 0x01` `'U'`)                                         | ✅                                                   | ✅                      |
| Text (`TNF 0x01` `'T'`)                                        | ✅                                                   | ✅                      |
| MIME media (`TNF 0x02`)                                        | ✅                                                   | ✅                      |
| Absolute URI (`TNF 0x03`)                                      | ✅                                                   | ✅                      |
| **Android Application Record** (`TNF 0x04`, `android.com:pkg`) | ✅ the OS launches or offers to install that package | ❌ **ignored entirely** |
| Smart Poster                                                   | out of scope (Phase 2)                               | out of scope (Phase 2)  |

The AAR is a record type whose entire meaning is "Android, run this app". iOS reads the bytes
happily and does nothing with them. Tag Info says so inline on any AAR record it finds, rather
than leaving the reader to wonder why a tag behaves differently in their hand.

One decoding detail that _is_ a platform difference rather than a format one: a record's `type`
arrives as a **byte array on Android** and sometimes as an **already-decoded string on iOS**. A
`number[]` never equals `'U'`, so a naive comparison does not error — it silently falls through to
"unknown record". `lib/ndef.ts` normalises before comparing.

### Scan errors: what is observed, and what is still a guess

Every error class in `react-native-nfc-manager` is constructed with no arguments, so `err.message`
is `''` on **both** platforms — see §5 above and DEVLOG §1.13. Phase 2 classifies on the class
instead and maps ten classes onto eight kinds.

Only one row below has been seen on a device. The rest are read from the library's source and are
flagged `provisional` in the code itself.

| Kind              | Android                                       | iOS                               | Status                            |
| ----------------- | --------------------------------------------- | --------------------------------- | --------------------------------- |
| `cancelled`       | from the string `'cancelled'`                 | from `NFCError:200`               | ✅ **observed on iOS** 2026-09-05 |
| `timeout`         | ⏳                                            | ⏳ OS enforces ~60s               | provisional                       |
| `connection-lost` | ⏳                                            | ⏳                                | provisional                       |
| `not-ndef`        | ⏳ arrives as _text_ in a bare `NfcErrorBase` | ⏳ `FirstNdefInvalid`             | provisional — task H1             |
| `system-busy`     | ⏳                                            | ⏳                                | provisional                       |
| `nfc-off`         | ⏳ reachable — NFC is a toggle                | ❌ unreachable — no toggle exists | provisional                       |

Note the last row: `nfc-off` is not merely untested on iOS, it is **unreachable by construction**,
the same asymmetry §7 describes for `isNfcEnabled()`.

Note also the `not-ndef` shape difference, which is the deeper one: **iOS returns a numeric code
that the library maps to a class; Android returns a human-readable string that it wraps in the base
class.** So on iOS we can match a type, and on Android we are reduced to substring-matching a
message. That is a genuinely worse position to be in, and it is invisible until you try to handle
the error rather than display it.

⏳ Still to observe on hardware: timeout behaviour on each platform, and what Android reports
when a tag is pulled away mid-read.

## 6. Write flow & error behaviour

| Scenario                  | Android | iOS |
| ------------------------- | ------- | --- |
| Tag pulled away mid-write | ⏳      | ⏳  |
| Tag too small for payload | ⏳      | ⏳  |
| Read-only / locked tag    | ⏳      | ⏳  |
| Unformatted tag           | ⏳      | ⏳  |

## 8. Writing the native layer ourselves

Phases 1–3 saw these platforms through `react-native-nfc-manager`. Phase 4 replaced it with our own
Swift and Kotlin, which changed what is visible: the differences below are not what a library
chose to expose, they are what the platforms actually are.

### The shape of a scan

|                  | Android                               | iOS                                                                |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------ |
| API style        | ⏳ reader-mode callback on an adapter | ✅ **session + delegate**, four nested async steps                 |
| Who owns the UI  | the app                               | **CoreNFC** — a system sheet we cannot restyle                     |
| Session lifetime | ⏳ tied to the activity               | ✅ one tag, then invalidated — including on success                |
| Cancelling       | ⏳ the app must provide it            | ✅ the system sheet does it                                        |
| Retention hazard | ⏳                                    | ✅ **the session must be retained or the sheet vanishes silently** |

That last row has no Android equivalent and no error message. A `NFCTagReaderSession` held in a
local variable is deallocated when the function returns, and the sheet simply disappears — the
single easiest way to get a CoreNFC integration wrong.

### Entitlements are per **polling option**, not per feature

Phase 1 established that iOS needs an entitlement to read NFC at all (§2). Writing the session
ourselves surfaced a finer-grained version of the same rule:

| Polling option | Extra entitlement required                                     |
| -------------- | -------------------------------------------------------------- |
| `.iso14443`    | none beyond the `TAG` format — covers NTAG and MIFARE          |
| `.iso15693`    | none beyond `TAG`                                              |
| `.iso18092`    | **`com.apple.developer.nfc.readersession.felica.systemcodes`** |

Requesting a polling option you cannot sign for fails the **whole session** with
`Missing required entitlement` — not just that mode, and without naming FeliCa. Android has no
analogue: one `android.permission.NFC` covers everything the adapter can do.

### Capacity and writability, settled

| Question | Android read      | iOS read       | Either, in a session            |
| -------- | ----------------- | -------------- | ------------------------------- |
| Capacity | ✅ `getMaxSize()` | ❌ not carried | ✅ **both** (`queryNDEFStatus`) |
| Writable | ✅ `isWritable`   | ❌ not carried | ✅ **both** (status)            |

Our module asks the status query on **every read**, so on iOS the app now has a capacity where the
library's read path gave it none. That is a difference in what we chose to ask, not in what the
platform can answer — see the correction at the top of §5.

### Errors, from the inside

|                       | `react-native-nfc-manager`    | Ours                   |
| --------------------- | ----------------------------- | ---------------------- |
| Carries a message     | ❌ always `''` (§1.13)        | ✅                     |
| Carries a code        | ❌ meaning lives in the class | ✅                     |
| Survives minification | ⚠️ needs `instanceof`         | ✅ matched by code     |
| Reaches JS unwrapped  | n/a                           | ❌ **wrapped by Expo** |

The last row is the one that cost time. Expo wraps a native exception in a `FunctionCallException`
and derives its code from the class name — `UserCancelledException` arrives as `ERR_USER_CANCELLED`
(`expo-modules-core/ios/Core/Exceptions/CodedError.swift:45`). Writing your own typed errors is
necessary but not sufficient; the framework's plumbing still sits between you and the caller.
DEVLOG §4.5.

### Still ⏳ — everything Android in this section

No Android device has been available since Phase 1. The Kotlin module compiles and is written
against the documented API, and **not one line of it has been run.**

## 7. Things one platform simply cannot do

| Capability                      | Android                           | iOS                                                                | Notes                                                       |
| ------------------------------- | --------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| Detect NFC hardware present     | ✅ `NfcAdapter`                   | ✅ `NFCNDEFReaderSession.readingAvailable`                         |                                                             |
| Detect NFC **enabled/disabled** | ✅ `adapter.isEnabled()`          | ❌ **No such concept** — there is no user-facing NFC toggle on iOS | Drives the `isNfcEnabled()` asymmetry in our Phase 4 module |
| Deep-link to NFC settings       | ✅ `Settings.ACTION_NFC_SETTINGS` | ❌ No equivalent URL exists                                        | Our module throws a typed unsupported-platform error        |
| Read tags with the app closed   | ✅ intent filter                  | ⚠️ Limited, OS-mediated                                            | Phase 3                                                     |
| NFC on tablets                  | ✅ Many Android tablets           | ❌ **No iPad has ever shipped CoreNFC**                            | Why `supportsTablet: false` in `app.json`                   |
| NFC in a simulator/emulator     | ❌                                | ❌                                                                 | All testing is on hardware, on both platforms               |

**The `isNfcEnabled()` asymmetry is the best teaching moment in the whole project.** The
naive cross-platform API is `isNfcEnabled(): boolean`. On Android it is a real, changeable
runtime state the user controls in Settings. On iOS the question is _meaningless_ — there
is no toggle, so the only honest answer is "if the hardware supports it, it is on". A
cross-platform API that pretends these are the same thing is lying to its caller. Phase 4
handles it explicitly instead of papering over it.
