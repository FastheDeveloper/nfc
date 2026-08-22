# TapCard — DEVLOG

Running build log for the freeCodeCamp article. Every phase records: exact commands and
why, every error **verbatim** plus root cause and fix, decisions and trade-offs, and
`[SCREENSHOT]` markers for the article.

---

## Phase 0 — Scaffold & sanity

### 0.1 Environment audit (before touching anything)

Ran the audit first because NFC work fails in slow, confusing ways when the toolchain is
subtly wrong, and because "here is how you check your machine is ready" is the first thing
a reader needs.

```bash
node -v && npm -v && pnpm -v
java -version && /usr/libexec/java_home -V
echo $ANDROID_HOME && adb version
xcodebuild -version && pod --version
adb devices -l
xcrun devicectl list devices
security find-identity -v -p codesigning
```

Result on this machine (2026-08-18):

| Tool        | Version                        | Note                                    |
| ----------- | ------------------------------ | --------------------------------------- |
| Node        | v20.19.4                       | via nvm                                 |
| pnpm        | 10.28.0                        | chosen package manager                  |
| JDK         | Zulu 17.0.10 (`JAVA_HOME` set) | RN requires JDK 17                      |
| Android SDK | `~/Library/Android/sdk`        | build-tools 35/36/36.1, platforms 33–36 |
| adb         | 36.0.2                         | Homebrew                                |
| Xcode       | 26.6 (17F113), iOS SDK 26.5    |                                         |
| CocoaPods   | 1.16.2                         | rbenv ruby 3.2.2                        |
| EAS CLI     | 22.0.0                         | logged in as `fasdev`                   |

**Surprise #1 — disk pressure.** `df -h /System/Volumes/Data` reported **24 GB free (95%
full)**. A two-platform RN project's DerivedData + Pods + Gradle caches realistically eats
8–15 GB. Flagged before scaffolding rather than debugging a cryptic build failure later.
_Article note: worth a callout box — this is a real and under-documented failure mode._

**Surprise #2 — no NFC entitlement anywhere in the existing Apple account.** Dumped all 15
local provisioning profiles:

```bash
for f in ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision; do
  security cms -D -i "$f" | plutil -extract TeamIdentifier.0 raw -
done | sort | uniq -c
```

Three teams present; **zero** profiles contained an NFC key. So a new App ID with the NFC
Tag Reading capability is definitely required — this is not something Xcode's automatic
signing quietly solves for you. Phase 1 covers the exact portal clicks.

### 0.2 Decisions

| Decision            | Choice                    | Why                                                                           |
| ------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| iOS test device     | iPhone 13 Pro ("Fas")     | Full CoreNFC read/write + background tag reading                              |
| Apple team          | Recdek Ltd (`V993Z3KD7P`) | Matches the previous article app's namespace                                  |
| Bundle ID / package | `com.fasarticle.tapcard`  | Same ID on both platforms                                                     |
| Scaffold tool       | `create-expo-stack`       | Pre-wires Expo Router + NativeWind + Zustand + EAS                            |
| Styling             | NativeWind                |                                                                               |
| Package manager     | pnpm                      | CES writes `node-linker=hoisted` for RN autolinking                           |
| Native dirs         | gitignored (CNG)          | Config plugins are the source of truth; `ios/` and `android/` are regenerated |

### 0.3 Scaffolding

First attempt used `create-expo-app` (Expo SDK 57). Switched to `create-expo-stack` on
request. **Inspected the CLI's templates before running it** rather than trusting the
docs — the payoff was immediate:

```bash
npm pack create-expo-stack@latest && tar xzf create-expo-stack-*.tgz
cat package/build/templates/base/package.json.ejs
```

**Surprise #3 — create-expo-stack 2.23.1 pins Expo SDK 56, not 57.** Its base template
hardcodes `"expo": "~56.0.4"`, `"react-native": "0.85.3"`, `"expo-router": "~56.2.6"`,
`"zustand": "^4.5.1"`. The CLI advertises no SDK version anywhere in its help output.
_Article note: always unpack a scaffolder before you trust it._

Also read `runCLI.js` to recover the full interactive question set, which let us drive it
non-interactively:

```bash
npx create-expo-stack@latest tapcard \
  --nonInteractive --pnpm --exporouter --tabs --nativewind --zustand --eas \
  --importAlias --noInstall --noGit --overwrite
```

**Error (verbatim):**

```
Eas configuration requires installing dependencies, please remove the --no-install flag and try again.
```

**Root cause:** `runEasConfigure.js` hard-exits when `flags.noInstall` is set — it needs to
run `eas build:configure -p all` and `expo prebuild`, both of which need `node_modules`.
**Fix:** accepted the skip. The `--eas` flag had _already_ done the useful part at template
render time (dev-client scripts + `expo-dev-client` + `expo-device` in `package.json`).
`eas.json` is written by hand instead — `eas build:configure` is interactive and would
create a cloud project as a side effect, which should be a deliberate act, not a scaffold
side effect.

Project was generated into `tapcard/` and moved to the repo root.

**Gotcha:** `shopt -s dotglob` is a bashism; this shell is zsh, so `mv tapcard/* .` silently
left `.gitignore` and `.npmrc` behind and `rmdir` then failed with
`rmdir: tapcard: Directory not empty`. Moved the dotfiles explicitly.

### 0.4 Post-scaffold cleanup, driven by `npx expo-doctor`

Doctor found 3 issues on the fresh scaffold — i.e. **create-expo-stack does not produce a
clean project against its own pinned SDK.** Good article beat.

1. **`@react-navigation/native` installed alongside expo-router.**

   > As of SDK 56, expo-router is no longer compatible with react-navigation.

   Confirmed nothing imported it (`grep -rn "@react-navigation" app components store`),
   then `pnpm remove @react-navigation/native`.

2. **`react-native-screens` 4.25.2 vs expected ~4.26.0.** Fixed with `npx expo install --fix`.

3. **Hermes V1 memory regression** — see below. Unresolved at time of writing.

```
✖ Check for Expo SDK versions affected by Hermes V1 regressions
This project uses Hermes V1 with expo@56.0.20, which is affected by a known memory regression.
Detected Hermes V1 250829098.0.10 from React Native. Hermes V1 250829098.0.15 and earlier
are affected by this regression; 250829098.0.16 is the first version that contains the fix.
```

After fixes 1 and 2: **21/22 checks pass.**

### 0.5 Dependency adjustments

- `npx expo install @react-native-async-storage/async-storage` → 2.2.0 (profile persistence)
- `pnpm add zustand@^5` → 5.0.15. CES pinned v4.5.1; v5 is current. The generated
  `store/store.ts` already used the named `{ create }` import, so it is v5-clean as-is.

### 0.6 Why expo-dev-client and not Expo Go — _article talking point_

Expo Go is a **prebuilt** binary. Its native code is fixed: whatever native modules
Expo shipped inside it, and nothing else. NFC requires native code that is not in
that binary — the Android `NfcAdapter` plumbing and iOS CoreNFC — and, critically,
iOS NFC requires an **entitlement baked into the signed app** at build time. No
JavaScript can add an entitlement to an already-signed binary.

So the moment a project touches NFC it needs its own native build, which means
`expo-dev-client`: the same fast JS reload loop as Expo Go, but running inside _our_
binary with _our_ entitlements. This is the single most useful thing for a reader to
internalise, and it generalises far beyond NFC.

---

### 0.7 SDK 56 → 57 upgrade (reversing an earlier decision)

`expo-doctor` reported a **known Hermes V1 memory regression** in expo@56.0.20 with an
explicit official fix: upgrade to SDK 57. This reversed the earlier "SDK 56 is safer"
call — that argument weighed a _hypothetical_ risk (legacy bridge module on a newer RN)
against what turned out to be a _documented_ bug, in a subsystem (memory) that NFC scan
sessions and NDEF buffers are well placed to provoke.

```bash
npx expo install expo@^57.0.9 --fix
```

**Error (verbatim):**

```
├─┬ expo-router 57.0.14
│ └── ✕ unmet peer @expo/log-box@^57.0.3: found 56.0.14
├─┬ @expo/metro-runtime 57.0.11
│ └── ✕ unmet peer @expo/log-box@^57.0.3: found 56.0.14
✕ Conflicting peer dependencies:
  @expo/dom-webview
```

**Root cause:** `create-expo-stack` adds `@expo/log-box` as a _direct_ dependency pinned
`^56.0.12`. `expo install --fix` only upgrades packages in Expo's SDK version map, and
`@expo/log-box` is not in it — so `--fix` walked past it and left a v56 package satisfying
a v57 peer requirement. `npx expo install @expo/log-box` also did nothing, for the same
reason.

**Then this:**

```
✖ Check that no duplicate dependencies are installed
Found duplicates for @expo/log-box:
  ├─ @expo/log-box@56.0.14 (at: node_modules/@expo/log-box)
  └─ @expo/log-box@57.0.3 (at: node_modules/expo/node_modules/@expo/log-box)
```

Two copies of a native module in one build — exactly what doctor warns is unbuildable.

**Fix:** pin it by hand to the version expo-router actually asks for.

```bash
pnpm add "@expo/log-box@~57.0.3"
```

**Result: 21/21 doctor checks pass.** Final stack: expo 57.0.14, react-native 0.86.2,
react 19.2.3, expo-router 57.0.14, nativewind 4.2.6, reanimated 4.5.1, worklets 0.10.1,
zustand 5.0.15, async-storage 2.2.0, expo-dev-client 57.0.13.

_Article lesson: `expo install --fix` is not a general-purpose upgrader. It only knows the
packages Expo curates. Anything a third-party scaffolder pinned outside that map is yours
to chase, and the failure mode is a duplicate native module rather than a clear error._

`npx tsc --noEmit` passes clean, and CES's NativeWind 4 / Reanimated 4 config
(`jsxImportSource: "nativewind"`, `react-native-worklets/plugin`, `withNativeWind` in
metro) needed no changes on 57 despite being authored for 56.

### 0.8 Native project generation

```bash
npx expo prebuild --clean
```

Succeeded first try, CocoaPods included. Verified the identities landed:

|                                       | Value                                   |
| ------------------------------------- | --------------------------------------- |
| iOS `PRODUCT_BUNDLE_IDENTIFIER`       | `com.fasarticle.tapcard`                |
| iOS `IPHONEOS_DEPLOYMENT_TARGET`      | 16.4                                    |
| iOS `DEVELOPMENT_TEAM`                | _(unset — supplied at first `run:ios`)_ |
| Android `namespace` / `applicationId` | `com.fasarticle.tapcard`                |

The generated `AndroidManifest.xml` currently has **no NFC permission and no NFC intent
filter** — as expected, since `react-native-nfc-manager` is not installed yet. Worth
capturing this "before" manifest for the article: Phase 1's diff against it shows exactly
what the config plugin contributes, which is the clearest possible way to demystify what a
config plugin _is_.

**Surprise #4 — disk.** Free space went from 24 GB to **12 GB** across prebuild. `ios/Pods`
alone is 1.2 GB; the whole project is 1.7 GB. The earlier warning was not theoretical.
Machine-wide reclaimable caches at this point: DerivedData 24 GB, `~/.gradle` 26 GB,
CoreSimulator devices 8.1 GB, CocoaPods cache 1.8 GB.

---

## Phase 0 — findings pending

- [x] ~~Hermes V1 regression~~ → upgraded to SDK 57, 21/21 checks pass
- [ ] Free disk space before first device builds
- [ ] `eas init` (creates the cloud project) — user action, deferred to Phase 5
- [ ] First build on both physical devices — **blocked: neither device connected**
