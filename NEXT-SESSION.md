# ⏸ Paused — resume here

**Paused:** 2026-08-22 · **Reason:** NFC chips lost; replacements ordered, expected ~2026-08-29.
**Blocker is hardware only.** Nothing in the codebase is broken or half-finished.

> This file is working state, not article material. DEVLOG.md and PLATFORM-NOTES.md are the
> article deliverables.

---

## Where things stand

|                                                  | Status                                  |
| ------------------------------------------------ | --------------------------------------- |
| Phase 0 — scaffold & boot on both devices        | ✅ **passed** (committed)               |
| Phase 1 — NFC plumbing, code                     | ✅ **complete**, uncommitted            |
| Phase 1 — iOS build, signed + installed on "Fas" | ✅ done                                 |
| Phase 1 — **gate: scan a real tag**              | ⛔ **blocked — no chips**               |
| Phase 1 — Android build this phase               | ⛔ not run (phone was never plugged in) |
| Phases 2–5                                       | not started                             |

`tsc`, ESLint, Prettier clean · `expo-doctor` 21/21 · both platforms bundle to Hermes.

## Project identity (settled — do not change casually)

|                                   | Value                                                   |
| --------------------------------- | ------------------------------------------------------- |
| iOS bundle ID / Android package   | `com.nfccard.tap`                                       |
| Apple team                        | Recdek Ltd — `V993Z3KD7P`                               |
| App ID registered in portal       | ✅ with **NFC Tag Reading** enabled                     |
| Provisioning profile entitlements | `[NDEF, TAG, PACE]`, includes device "Fas"              |
| iOS test device                   | "Fas" — iPhone 13 Pro, UDID `00008110-001E2D6E02EA401E` |

Renaming again is cheap in code (two lines + `prebuild`) but an App ID **cannot be renamed** in
the Apple portal — a rename means registering a new one.

## Stack

Expo `~57.0.15` · React Native `0.86.2` · React `19.2.3` · expo-router `~57.0.15` ·
react-native-nfc-manager `^3.17.2` · Zustand `^5.0.15` · AsyncStorage `2.2.0` · NativeWind ·
pnpm (`node-linker=hoisted`) · `ios/` and `android/` are **gitignored and generated** (CNG).

## First thing to do when the chips arrive

```bash
cd /Users/fas/2025.nosync/nfc
npx expo start --dev-client      # app is already installed on "Fas"
```

Open **TapCard** on the iPhone — pick `com.nfccard.tap`, since the old `com.fasarticle.tapcard`
build may still be installed. Then close the **Phase 1 gate**:

**iPhone**

1. Read tab → device banner, green **NFC ready** card, **Scan a tag** button.
2. Tap **Scan** → Apple's system NFC sheet must appear showing
   _"TapCard uses NFC to read and write your digital business card to a tag."_
   (that string appearing proves the entitlement is live).
3. Hold the chip to the **top edge** of the phone — iPhone's antenna is at the top, unlike
   Android's centre-back.
4. Repeat, but tap **Cancel** on the sheet instead. **Record the error text verbatim.**

**Android** — needs the phone plugged in, USB debugging on, RSA prompt accepted:

```bash
adb devices -l                   # must not be empty or "unauthorized"
npx expo run:android             # not built since the identifier changed
adb uninstall com.fasarticle.tapcard   # orphan from the rename
```

5. Tap Scan → **no system UI appears**; our own indigo card + **Cancel** button shows instead.
6. Hold the chip to the **centre-back** of the phone.

Also delete the old **TapCard** (`com.fasarticle.tapcard`) from the iPhone — both are installed.

### Two data points PLATFORM-NOTES.md is explicitly waiting on

1. Blank-tag readout on each device — ID, tech types, **max size** (the NTAG213 ~144-byte figure
   drives Phase 3's vCard capacity warning).
2. The exact cancel-error text on each platform. Phase 1 deliberately renders raw errors so
   Phase 2's UX is designed around observed behaviour, not assumption.

📸 Screenshot both scanning states — the iOS system sheet vs Android's silent scan is the
article's best visual.

### Expected, not a bug

A factory-fresh tag may be **not NDEF-formatted**, in which case
`requestTechnology(NfcTech.Ndef)` can fail instead of returning an empty message, and Android may
report `NdefFormatable` rather than `Ndef`. Capture the error verbatim — handling it is Phase 2's
job.

## Then: Phase 4 was pulled up for discussion

Sequencing is still open. Phase 4 (the hand-written `nfc-capabilities` Expo Module in Kotlin +
Swift) is independent of Phases 2–3 and is the article's second act. Tooling verified:
`create-expo-module --local` exists and takes `--name`, `--package`, `-p apple android`
(**`apple`**, not `ios`), `--features Function`.

The asymmetry it models is already evidenced in the library's own source — see DEVLOG §1.5,
PLATFORM-NOTES §7, and the inline comment at `lib/nfc.ts:58` marking the branch that is
unreachable by construction on iOS.

## Safety rules still in force

- **Reading a tag cannot alter it.** Phase 1 only reads — scan freely.
- **Phase 3 writes** — overwrites content, but reversible.
- **Phase 5 locks a tag read-only — permanent.** Never do this without naming a specific
  sacrificial chip first.

## Traps already hit — don't re-learn these

- `| tee` makes Expo non-interactive (`isTTY` undefined) and kills its prompts. Use
  `script -q /tmp/log <cmd>` to log while keeping a TTY, or pass `--device Fas` to avoid prompting.
- A JS-only dependency bump can invalidate `ios/Podfile.lock`, because Expo podspecs read
  `s.version` from their own `package.json`. Fix: `rm ios/Podfile.lock && cd ios && pod install`.
  Android never hits this — Gradle re-resolves from `node_modules` every build. (DEVLOG §0.10)
- `plutil -extract` treats dots as key-path separators, so extracting a dotted entitlement key
  silently reports "missing". Extract the whole `Entitlements` dict instead. (DEVLOG §1.9)
- The `withBuildScriptExtVersion: Cannot set minimum buildscript.ext.compileSdkVersion` warning on
  every `prebuild` is **harmless** — resolved compileSdk is 36. (DEVLOG §1.4)
- `expo-doctor`'s "Untested on New Architecture: react-native-nfc-manager" is a **known accepted
  risk**, now excluded via `expo.doctor.reactNativeDirectoryCheck.exclude` in `package.json`. The
  library is a legacy bridge module running through RN's interop layer; that is exactly why
  Phase 4 exists. Do not treat it as new.
