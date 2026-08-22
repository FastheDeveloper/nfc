# TapCard — iOS vs Android, side by side

The running comparison that becomes the article's headline section. Filled in
continuously as we hit each difference on real hardware. Nothing in this file is
theoretical — if it is written here, we observed it on a device.

Legend: ✅ works · ⚠️ works with caveats · ❌ not possible on this platform · ⏳ not yet tested

---

## 1. Project setup & first build

|                          | Android                                                                 | iOS                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Toolchain                | JDK 17 (Zulu 17.0.10) + Android SDK + Gradle                            | Xcode 26.6 + CocoaPods 1.16.2                                                                                |
| Identity needed          | Package name only (`com.fasarticle.tapcard`) — no account required      | Bundle ID **plus** an Apple Developer team (`V993Z3KD7P`), a signing certificate, and a provisioning profile |
| Cost to get started      | £0                                                                      | £99/yr — **NFC is not available on a free provisioning profile**                                             |
| Device prep              | Enable Developer Options → USB debugging, accept RSA fingerprint prompt | Unlock, "Trust This Computer", device registered to the team                                                 |
| First build command      | `npx expo run:android`                                                  | `npx expo run:ios --device`                                                                                  |
| Build time (first)       | ⏳                                                                      | ⏳                                                                                                           |
| Build time (incremental) | ⏳                                                                      | ⏳                                                                                                           |

**Observation so far:** the asymmetry starts before a line of code is written. Android
needs a name; iOS needs a _legal identity, a paid subscription, and a capability enabled
in a web portal_. For an NFC article this is the single biggest barrier-to-entry
difference and it deserves to be stated plainly up front.

## 2. Permission & configuration model

|                                         | Android                                                         | iOS                                                                                             |
| --------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Mechanism                               | `AndroidManifest.xml` — `<uses-permission>` + `<intent-filter>` | `.entitlements` + `Info.plist` + a capability toggled in the Apple Developer portal             |
| NFC declaration                         | `android.permission.NFC`                                        | `com.apple.developer.nfc.readersession.formats = [NDEF, TAG]`                                   |
| User-facing prompt                      | **None.** NFC is not a runtime permission                       | `NFCReaderUsageDescription` string shown in the system NFC sheet                                |
| Server-side component                   | None                                                            | ✅ App ID must have "NFC Tag Reading" enabled in the portal — a local-only change is not enough |
| Handled by the library's config plugin? | Permission ✅ / intent-filter ❌                                | Entitlement ✅ / usage string ✅ / portal ❌ (manual)                                           |

**Already confirmed by inspection** (`npm pack react-native-nfc-manager` → `app.plugin.js`):
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
| Screenshot                 | ⏳ `[SCREENSHOT: Android silent scan]`       | ⏳ `[SCREENSHOT: iOS system NFC sheet]`                                |

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

|                                | Android | iOS |
| ------------------------------ | ------- | --- |
| ⏳ To be filled as we hit them |         |     |

## 6. Write flow & error behaviour

| Scenario                  | Android | iOS |
| ------------------------- | ------- | --- |
| Tag pulled away mid-write | ⏳      | ⏳  |
| Tag too small for payload | ⏳      | ⏳  |
| Read-only / locked tag    | ⏳      | ⏳  |
| Unformatted tag           | ⏳      | ⏳  |

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
