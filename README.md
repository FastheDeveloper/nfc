# TapCard

An NFC digital business card app for iOS and Android, built with Expo + React Native.
Write your contact details to a physical NFC tag as a URL or a vCard, and read any NDEF
tag back in human-readable form.

This repo is the worked example behind a freeCodeCamp article. Two companion documents
are part of the deliverable, not notes:

- **[DEVLOG.md](./DEVLOG.md)** — every command, every error verbatim, every decision
- **[PLATFORM-NOTES.md](./PLATFORM-NOTES.md)** — the running iOS vs Android comparison

## Requirements

NFC does not work in the iOS Simulator or the Android emulator. **All testing is on
physical hardware, on both platforms.**

|           | Android                                 | iOS                                                                                                    |
| --------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Device    | A phone with NFC, USB debugging enabled | iPhone 7 or newer (no iPad has NFC)                                                                    |
| Toolchain | JDK 17, Android SDK, `adb`              | Xcode, CocoaPods                                                                                       |
| Account   | none                                    | **Paid Apple Developer account** — the NFC entitlement is not available on a free provisioning profile |
| Tags      | NTAG213/215/216 stickers                | same                                                                                                   |

## Stack

Expo SDK 57 · React Native 0.86 · TypeScript · Expo Router · NativeWind ·
Zustand + AsyncStorage · `react-native-nfc-manager` · pnpm

There is no backend. The profile lives on the device and is written directly to the tag.

## Getting started

```bash
pnpm install
npx expo prebuild --clean     # generates ios/ and android/ from app.json

npx expo run:android          # physical Android device over adb
npx expo run:ios --device     # physical iPhone, select your team when prompted
```

`ios/` and `android/` are **gitignored on purpose**. This project uses Continuous Native
Generation: `app.json` plus config plugins are the source of truth, and the native
directories are regenerated. If you change native config, re-run `prebuild`.

This is a dev-client project, not an Expo Go project — see DEVLOG §0.6 for why that is
forced on us by NFC rather than chosen.

## Scripts

| Command                     | Does                                                                          |
| --------------------------- | ----------------------------------------------------------------------------- |
| `pnpm start`                | Metro for the dev client                                                      |
| `pnpm android` / `pnpm ios` | Build and install on a connected device                                       |
| `pnpm lint` / `pnpm format` | ESLint + Prettier                                                             |
| `pnpm test`                 | Jest — the NDEF decoder, tag facts, error mapping and store. No device needed |
| `npx expo-doctor`           | Validate the project against the installed SDK                                |

## Status

- [x] **Phase 0** — scaffold, SDK 57, hello screen on both devices
- [x] **Phase 1** — NFC plumbing, entitlements, raw NDEF read
- [x] **Phase 2** — Read & Tag Info screens, full NDEF parsing
- [ ] **Phase 3** — Profile editor, vCard + URL writing, capacity checks
- [ ] **Phase 4** — `nfc-capabilities`, our own Expo Module in Kotlin + Swift
- [ ] **Phase 5** — read-only locking, EAS comparison, article prep
