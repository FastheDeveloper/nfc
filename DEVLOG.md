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

### 0.9 Resuming after a break — patch drift and a pnpm peer-resolution gap

_Session 2, 2026-08-22._ Picking the project back up after a few days. Two things had
changed on disk without anyone editing source: `package.json` and `pnpm-lock.yaml` were
dirty. The `package.json` diff was pure SDK 57 patch drift plus a `packageManager` field:

```diff
-    "expo": "~57.0.14",
-    "expo-constants": "~57.0.12",
-    "expo-dev-client": "~57.0.13",
+    "expo": "~57.0.15",
+    "expo-constants": "~57.0.13",
+    "expo-dev-client": "~57.0.14",
-    "expo-linking": "~57.0.6",
-    "expo-router": "~57.0.14",
+    "expo-linking": "~57.0.7",
+    "expo-router": "~57.0.15",
+  "packageManager": "pnpm@10.28.0+sha512...."
```

Worth flagging for the article because it _looks_ alarming ("did I upgrade to the wrong
SDK?") and isn't: every one of those is a patch bump **inside** SDK 57. The caret/tilde
ranges we committed permit it, and `expo install` rewrites the pinned string when it
resolves. The versions that actually define the SDK are unchanged — `react-native@0.86.2`,
`react@19.2.3`, `expo@~57`. Reading a dependency diff by _range semantics_ rather than by
"the numbers moved" is a genuinely useful skill to teach.

**Error — `expo-doctor` 20/21, verbatim:**

```
✖ Check for overridden dependencies
An incompatible version of a critical dependency is installed, which is unsupported and may cause unexpected behavior.
"expo-router" should install "@expo/metro-runtime@^57.0.12", but 57.0.11 is installed.
Advice:
Reinstall your dependencies and check that they're not in a corrupted state.
```

The advice ("reinstall your dependencies") is a red herring — reinstalling reproduces it,
because the cause is structural. `pnpm why` shows that **nothing declares
`@expo/metro-runtime` as a real dependency**; every single edge is a `peer`:

```
expo 57.0.15 peer
├─┬ @expo/cli 57.0.17
│ ├─┬ @expo/router-server 57.0.7
│ │ ├── @expo/metro-runtime 57.0.11 peer
│ │ └─┬ expo-router 57.0.15 peer
│ │   └── @expo/metro-runtime 57.0.11 peer
```

So the version came from pnpm's auto-install-peers resolution, which had settled on 57.0.11
before `expo-router` bumped its requirement to `^57.0.12` in the patch drift above. No
package.json anywhere pins it, so no reinstall can move it.

**Root cause:** an unpinned auto-installed peer dependency going stale relative to a
patch-bumped consumer. **Fix** — promote it to a direct dependency so the range is ours to
control:

```bash
pnpm add "@expo/metro-runtime@~57.0.12"
```

Back to **21/21 checks passed**. This is the second time in this project that
`expo install --fix` could not repair something (the first was `@expo/log-box` in §0.7,
which it skipped because the package is outside Expo's version map). Both share one root:
`expo install --fix` only reasons about packages that are (a) direct dependencies and
(b) in Expo's bundled-version map. Anything else needs a manual pin. That is a genuinely
non-obvious limitation and belongs in the article.

**Re-validated after the change:** `tsc --noEmit` clean, and `expo export` produces Hermes
bytecode for both platforms (android 3.7 MB, ios 3.5 MB).

**Disk resolved.** Free space is now **78 GB** (82% used), up from 12 GB — the caches
flagged in §0.8 were cleared. `ios/Pods` and `Podfile.lock` survived, so no `pod install`
re-run was needed.

---

### 0.10 iOS build attempt #1 — `pod install` fails on a stale `Podfile.lock`

iPhone "Fas" finally showed as `available (paired)`, so we ran the build. It died before
Xcode was even invoked:

```
$ npx expo run:ios --device
⚠️  Something went wrong running `pod install` in the `ios` directory.
Command `pod install --repo-update` failed.
└─ Cause: This is often due to native package versions mismatching. Try deleting the
   'ios/Pods' folder or the 'ios/Podfile.lock' file and running 'npx pod-install' to resolve.
```

**First lesson: the wrapper hid the error.** Expo's CLI summarised the failure and threw the
actual CocoaPods diagnostic away. Re-running the underlying command by hand is what made it
solvable — a habit worth teaching explicitly:

```bash
cd ios && pod install
```

**The real error, verbatim:**

```
[!] CocoaPods could not find compatible versions for pod "ExpoModulesCore":
  In snapshot (Podfile.lock):
    ExpoModulesCore (from `../node_modules/expo-modules-core/ExpoModulesCore.podspec`)

  In Podfile:
    ExpoModulesCore (from `../node_modules/expo-modules-core/ExpoModulesCore.podspec`)

It seems like you've changed the version of the dependency `ExpoModulesCore` and it differs
from the version stored in `Pods/Local Podspecs`.
You should run `pod update ExpoModulesCore --no-repo-update` to apply changes made locally.
```

That message is confusing on purpose-of-fact: it prints the _same_ source line twice, because
for a path-based local podspec the _source_ never changed — only the resolved **version** did.

**Root cause.** Three files disagreed:

| File                                                   | `expo-modules-core` version |
| ------------------------------------------------------ | --------------------------- |
| `node_modules/expo-modules-core/package.json`          | 57.0.12                     |
| `ios/Pods/Local Podspecs/ExpoModulesCore.podspec.json` | 57.0.12                     |
| `ios/Podfile.lock`                                     | **57.0.11** ← stale         |

`ExpoModulesCore.podspec` reads its version straight from `package.json`
(`s.version = package['version']`), so the SDK 57 patch drift from §0.9 silently changed the
podspec's version. `Podfile.lock` was generated back at §0.8 and still pinned the old one.
This is the iOS-side consequence of the same drift — **a JS-level dependency bump
invalidated the native lockfile**, and nothing warned us until build time.

**Second lesson: CocoaPods' own advice was wrong.** It suggested
`pod update ExpoModulesCore --no-repo-update`, which fixes one pod. We checked the real
scope first by diffing every `Podfile.lock` version against its `node_modules` counterpart —
**14 pods had drifted, not one:**

```
EXConstants                 57.0.12 -> 57.0.13
Expo                        57.0.14 -> 57.0.15
ExpoAsset                   57.0.12 -> 57.0.13
ExpoFileSystem               57.0.4 -> 57.0.5
ExpoLinking                  57.0.6 -> 57.0.7
ExpoModulesCore             57.0.11 -> 57.0.12
ExpoModulesJSI               57.0.4 -> 57.0.5
ExpoModulesWorklets         57.0.11 -> 57.0.12
ExpoModulesWorkletsAdapter  57.0.11 -> 57.0.12
ExpoRouter                  57.0.14 -> 57.0.15
ExpoUI                      57.0.11 -> 57.0.12
expo-dev-client             57.0.13 -> 57.0.14
expo-dev-launcher           57.0.13 -> 57.0.14
expo-dev-menu               57.0.13 -> 57.0.14
```

Taking the advice literally would have fixed pod 1 of 14 and produced the identical error for
pod 2. Measuring the blast radius before acting turned fourteen round-trips into one.

_(`Yoga` and `hermes-engine` also appear to drift under a naive comparison. They are false
positives: `Yoga.podspec` hardcodes `0.0.0` and `hermes-engine` is versioned by the Hermes
build stamp, not by React Native's `package.json`. Worth mentioning so readers running the
same diff do not chase them.)_

**Fix.** Delete the lockfile and let CocoaPods re-resolve the whole graph:

```bash
rm ios/Podfile.lock
cd ios && pod install
```

Safe here, and worth explaining _why_ rather than presenting it as a ritual: every drifted pod
is a **local, path-based** podspec, so versions are read from `node_modules` on disk — there
is no remote registry that could hand us a surprise version. Deleting the lock cannot pull
anything unexpected. `ios/Pods/` was left in place, so nothing re-downloaded.

Result — `110 total pods installed`, and the resolved versions now match:

```
- ExpoModulesCore (57.0.12)
- expo-dev-client (57.0.14)
```

Re-ran the drift diff: 0 real drifts remaining.

The three `[!] ... has added 2 script phases` warnings for `ExpoFileSystem`,
`ExpoModulesCore` and `ExpoModulesWorklets` are **not** errors — they are Expo's precompiled
`.xcframework` phases. Expected, and noise a reader will otherwise mistake for a problem.

**Third lesson, and the one for the article:** the Android build hit nothing comparable.
Gradle resolves native module versions from `node_modules` at _every_ build, so the JS-level
patch drift was absorbed invisibly. iOS has a second, independently-versioned lockfile that
must be kept in sync by hand. Same drift, same commit, two completely different outcomes —
logged in PLATFORM-NOTES §1.

### 0.11 Build attempt #2 — `| tee` silently disabled the interactive prompts

Own goal, and a good one for the article because the error message names a "mode" nobody
opted into:

```
$ npx expo run:ios --device 2>&1 | tee /tmp/ios-build.log
CommandError: Input is required, but 'npx expo' is in non-interactive mode.
Required input:
> Select a device
```

**Root cause.** Piping to `tee` replaces stdout with a pipe, so `process.stdout.isTTY`
becomes `undefined`. Expo (like most modern CLIs) treats that as "not a human" and refuses
to prompt. Demonstrated directly:

```bash
$ script -q /dev/null node -e "console.log(process.stdout.isTTY)"   # true
$ node -e "console.log(process.stdout.isTTY)" | cat                 # undefined
```

The advice "capture the build log with `| tee`" is reflexively good and actively wrong for
any command that needs to prompt. Two fixes, both worth knowing:

1. **Remove the reason to prompt.** `-d, --device [device]` accepts a name or UDID:
   ```bash
   npx expo run:ios --device Fas
   ```
2. **Keep a real TTY while still logging** — `script(1)` allocates a pty, so the child
   still sees a terminal:
   ```bash
   script -q /tmp/ios-build.log npx expo run:ios --device Fas
   ```
   (Caveat: `script` records raw terminal output, so the log contains ANSI escape codes.)

Not platform-specific — the same trap applies to `npx expo run:android` — so this stays in
DEVLOG rather than PLATFORM-NOTES.

---

## Phase 0 — findings pending

- [x] ~~Hermes V1 regression~~ → upgraded to SDK 57, 21/21 checks pass
- [x] ~~Free disk space before first device builds~~ → 78 GB free
- [x] ~~`@expo/metro-runtime` peer drift~~ → pinned as a direct dependency (§0.9)
- [x] **Android device build — PASSED.** App booted on the physical Android phone.
- [x] ~~iPhone "Fas" unreachable~~ → now `available (paired)`
- [x] ~~`pod install` failure on stale `Podfile.lock`~~ → 14 drifted pods re-resolved (§0.10)
- [x] **iOS device build — PASSED.** App built and booted on iPhone "Fas" (iPhone 13 Pro).
- [x] **PHASE 0 GATE PASSED — both physical devices.**
- [ ] `eas init` (creates the cloud project) — user action, deferred to Phase 5

---

## Phase 1 — NFC plumbing

### 1.1 Library survey before installing

`react-native-nfc-manager` is still at **3.17.2** (published 2025-11-28). Before adding it we
unpacked the tarball and read it, rather than trusting the Phase 0 notes. Two of the three
risks flagged in Phase 0 turned out to be **false alarms**, which is worth saying plainly —
predicting native breakage from a `build.gradle` skim is easy and often wrong.

| Phase 0 prediction                                                                                   | Reality                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `implementation 'com.facebook.react:react-native:+'` will fail — modern RN publishes `react-android` | ✅ **Non-issue.** The React Native Gradle Plugin installs a dependency _substitution_ rule: `com.facebook.react:react-native` → `react-android` at the pinned version. See `DependencyUtils.kt`: _"Substituting `react-native` with `react-android`"_.                                                        |
| The ancient `compileSdkVersion` / `minSdkVersion` method DSL will fail on a modern AGP               | ✅ **Non-issue here.** That DSL is deprecated in AGP 8.x and only _removed_ in AGP 9. We resolved the actual toolchain: **AGP 8.12.0**, Gradle 9.3.1, Kotlin 2.1.20. It compiles. (Had Expo shipped AGP 9, this library would be dead in the water — worth stating as a real future risk, not a current one.) |
| `s.platform = :ios, "8.0"` in the podspec vs a 16.4 deployment target                                | ✅ **Non-issue.** A pod declaring a _lower_ floor is fine; CocoaPods takes the project's target, and Expo's `post_install` raises pod targets anyway.                                                                                                                                                         |
| The bundled config plugin does not add the Android `NDEF_DISCOVERED` intent filter                   | ❌ **Confirmed.** Verified against the generated manifest below. Still ours to write in Phase 3.                                                                                                                                                                                                              |
| No `codegenConfig` / TurboModule spec — legacy bridge module                                         | ❌ **Confirmed.** `package.json` has no `codegenConfig`; `src/NativeNfcManager.js` uses `NativeModules.NfcManager` + `new NativeEventEmitter(...)`. On bridgeless SDK 57 this runs through RN's TurboModule **interop** layer.                                                                                |

How to resolve the AGP version yourself, since it is not written literally in any file
(Expo's `android/build.gradle` declares `classpath('com.android.tools.build:gradle')` with no
version):

```bash
cd android && ./gradlew buildEnvironment | grep "tools.build:gradle"
#  +--- com.android.tools.build:gradle:8.12.0
```

### 1.2 The library's TypeScript types are invalid TypeScript

We are TypeScript throughout, so we checked the types before writing against them.
`package.json` has **no `types` field**; a single `index.d.ts` sits in the package root, which
TypeScript finds by convention. Its structure is odd — a `declare module 'react-native-nfc-manager'`
block _plus_ a stray top-level `export default nfcManager;` on the last line.

First question: do the types actually apply, or is everything silently `any`? A `@ts-expect-error`
probe answers it definitively — if the types were `any`, the expected errors would not occur and
`tsc` would flag each directive as unused:

```ts
// @ts-expect-error — bogus method must error if types are real
await NfcManager.thisMethodDoesNotExist();
// @ts-expect-error — isSupported() returns Promise<boolean>, not string
const s: string = await NfcManager.isSupported();
```

Clean. **The types are real and enforced.** Good news, and a technique worth teaching: to prove
a type definition is doing work, assert that it _rejects_ something.

Second question answered accidentally — the file does not actually compile:

```
node_modules/react-native-nfc-manager/index.d.ts(90,30): error TS1246: An interface property cannot have an initializer.
node_modules/react-native-nfc-manager/index.d.ts(91,31): error TS1246: An interface property cannot have an initializer.
```

```ts
export interface CancelTechReqOpts {
  throwOnError?: boolean = false;     // <- illegal: interfaces cannot carry defaults
  delayMsAndroid?: number = 1000;
}
```

It builds only because Expo's base config sets `"skipLibCheck": true`, which uses a `.d.ts`'s
types without type-checking the file itself. A dependency shipping broken types that nobody
notices is a nice, concrete illustration of what that flag really buys — and what it hides.

### 1.3 Installing and wiring the plugin

```bash
npx expo install react-native-nfc-manager
```

`expo install` added the config plugin to `app.json` automatically. We then gave it a real
usage string, because the default (`"Interact with nearby NFC devices"`) is what iOS shows the
user inside the system NFC sheet:

```json
[
  "react-native-nfc-manager",
  { "nfcPermission": "TapCard uses NFC to read and write your digital business card to a tag." }
]
```

Reading `app.plugin.js` first told us exactly what the plugin does and does not do —
iOS entitlement + `NFCReaderUsageDescription` + `android.permission.NFC` + an attempted
`compileSdkVersion` bump. No Android intent filter.

### 1.4 `expo prebuild` — a config plugin failing loudly but harmlessly

```bash
npx expo prebuild --clean
```

```
» android: withBuildScriptExtVersion: Cannot set minimum buildscript.ext.compileSdkVersion
  version because the property "compileSdkVersion" cannot be found or does not have a numeric value.
```

**Root cause.** The plugin does _static text surgery_ on `android/build.gradle`, looking for an
`ext { compileSdkVersion = … }` block so it can force it to ≥ 31 (the library needs Android 12
APIs). Expo's SDK 57 template no longer has that block — `android/app/build.gradle` reads
`rootProject.ext.compileSdkVersion`, which the `expo-root-project` Gradle plugin injects at
_configuration_ time. There is no literal value in the file for the plugin to find, so its edit
silently does nothing and it warns.

**Does it matter?** No — and we checked rather than assuming:

```bash
cd android && ./gradlew -q :app:properties | grep -iE "^(compile|min|target)Sdk"
# compileSdkVersion: 36
# minSdkVersion: 24
# targetSdkVersion: 36
```

36 ≥ 31, so the guarantee the plugin wanted holds anyway. Good article beat: a config plugin
written against an older template shape, failing visibly, and being saved by the ecosystem
having moved _forward_ rather than back. It also shows why config-plugin warnings deserve
reading — this one was benign, but nothing about the message says so.

**Generated output, verified:**

```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<uses-permission android:name="android.permission.NFC"/>
```

```xml
<!-- ios/TapCard/TapCard.entitlements -->
<key>com.apple.developer.nfc.readersession.formats</key>
<array><string>NDEF</string><string>TAG</string></array>
```

```
$ plutil -extract NFCReaderUsageDescription raw ios/TapCard/Info.plist
TapCard uses NFC to read and write your digital business card to a tag.
```

And `grep -c NDEF_DISCOVERED android/app/src/main/AndroidManifest.xml` → **0**, confirming the
Phase 0 prediction. Android has the _permission_ to use NFC but no registration to be _launched_
by a tag. Phase 3.

### 1.5 The iOS/Android asymmetry is already visible in the library source

Before writing our own capability module in Phase 4, it is worth seeing that the library itself
cannot paper over the difference:

```js
// src/NfcManagerAndroid.js
isEnabled = () => handleNativeException(callNative('isEnabled'));
goToNfcSetting = () => handleNativeException(callNative('goToNfcSetting'));

// src/NfcManagerIOS.js
isEnabled = async () => {
  return true; // <- hardcoded
};
// ...and no goToNfcSetting at all.
```

On Android, "has NFC hardware" and "NFC is switched on" are two different questions, because
the user can toggle it. On iOS there is no toggle, so `isEnabled` is a constant and a
"open NFC settings" call has nothing to open. This is precisely the asymmetry Phase 4's
`nfc-capabilities` module exists to model explicitly instead of hiding. `lib/nfc.ts` documents
the `unreachable-by-construction` branch inline.

### 1.6 What we built

- **`lib/nfc.ts`** — `startNfc()` (memoised, never rejects), `checkNfcStatus()` →
  `checking | ready | disabled | unsupported`, `readTagOnce()`, plus hex/type formatting helpers.
  `startNfc` guards on `Device.isDevice` first, because `isSupported()` is not trustworthy on a
  simulator.
- **`app/_layout.tsx`** — `NfcManager.start()` once at app launch, so no screen has to care.
- **`app/(tabs)/index.tsx`** — capability gate, a Scan button, and a raw dump: tag id, type,
  tech types, max size, then per-record TNF / type / payload hex, then the whole `TagEvent` as
  JSON. Phase 1 deliberately shows raw errors instead of friendly ones — we want to _observe_
  how each platform reports cancels and timeouts before designing around them in Phase 2.
- **`components/Mono.tsx`** — see below.

**Bug avoided: `font-mono` does nothing in React Native.** Tailwind's `font-mono` is a _web_
font stack (`ui-monospace, SFMono-Regular, Menlo, …`). React Native's `fontFamily` accepts one
real family name and silently ignores what it cannot resolve, so hex dumps would have rendered
in the default sans font with no warning. The correct family also differs per platform — iOS
ships **Menlo**, Android resolves the generic alias **monospace**:

```ts
const family = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
```

A small thing, but a good example of a web-shaped Tailwind utility that is a no-op on native.

### 1.7 iOS signing — the wildcard profile that quietly worked, and now will not

Inspecting the Phase 0 build's signing turned up two things worth recording.

**1. The team is not the one we chose.** Phase 0 picked Recdek Ltd (`V993Z3KD7P`), but the
successful build wrote:

```json
"ios": { "appleTeamId": "533Y5NB8YV" }     // Talaris Capital and Investments Ltd
```

`expo run:ios` persists the selected team into `app.json`, so an interactive choice becomes
committed config — a mis-click at a prompt silently becomes project configuration, which is a
genuinely surprising thing about the local build flow and worth calling out.

**Corrected to Recdek Ltd (`V993Z3KD7P`)**, the team chosen in Phase 0, keeping
`com.fasarticle.tapcard` alongside the existing `com.fasarticle.droptrack` in one team. Switching
turned out to be a one-line change plus a regenerate, because `ios.appleTeamId` is consumed by a
config plugin rather than being hand-edited in Xcode:

```
node_modules/@expo/config-plugins/build/ios/DevelopmentTeam.js   -> withDevelopmentTeam
```

```bash
# app.json: "ios": { "appleTeamId": "V993Z3KD7P" }
npx expo prebuild -p ios
grep DEVELOPMENT_TEAM ios/TapCard.xcodeproj/project.pbxproj
#   DEVELOPMENT_TEAM = V993Z3KD7P;   (x2 — Debug and Release)
```

This is the CNG (Continuous Native Generation) payoff in miniature, and worth stating explicitly
for the article: because `ios/` is generated and gitignored, changing the signing team is an edit
to _declarative config_ rather than a hunt through Xcode's Signing & Capabilities UI. The
entitlement, usage string and bundle ID were all reproduced identically by the regenerate — the
only thing that changed is the one value we asked to change.

**2. Phase 0 signed against a wildcard profile — and that cannot survive Phase 1.** There is no
`com.fasarticle.tapcard` profile on disk at all:

```bash
for f in ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision; do
  security cms -D -i "$f" | plutil -extract Entitlements.application-identifier raw -
done | sort
# 533Y5NB8YV.*                         <- the Phase 0 build matched THIS
# 533Y5NB8YV.com.remotingwork.mobileapps
# ...17 profiles, and grep for "nfc.readersession" across all of them -> 0
```

The Phase 0 app had no entitlements, so the team's wildcard profile (`533Y5NB8YV.*`) matched and
Xcode signed it without anyone creating an App ID. **Apple does not allow special capabilities
such as NFC Tag Reading on a wildcard App ID.** Now that `TapCard.entitlements` requests
`com.apple.developer.nfc.readersession.formats`, no profile on this machine can satisfy it, and
none can be generated until an _explicit_ App ID with the capability enabled exists in the portal.

This is the cleanest example in the project of the iOS server-side configuration step having no
Android counterpart: the entitlement file is necessary but **not sufficient**, and the missing
half lives on Apple's servers. Expect the next iOS build to fail at signing until the portal
steps are done. Predicted, not accidental.

### 1.8 Renaming the app identifier — one config edit, two platforms

Changed the identifier from `com.fasarticle.tapcard`, on both platforms at once, before the Apple
App ID was registered. Doing it before registration matters: **App IDs cannot be renamed in the
Apple Developer portal.** Registering first and renaming after would have left a dead App ID and
required creating a second one.

The first choice, `com.tapcard.app`, was **rejected by the portal as unavailable**. Worth a line in
the article because the constraint surprises people: **App IDs are globally unique across every
Apple Developer account, not per-team.** A short, generic, brandable-sounding identifier is
therefore very likely to be already claimed by a stranger — and the portal tells you only at
registration time, long after the ID is baked into your project config, your Android package name,
and your Kotlin source tree.

The practical rule this teaches: pick a prefix under a domain you actually control, and register
the App ID _early_, before the identifier has propagated through the project. Settled on
**`com.nfccard.tap`**.

```json
"ios":     { "bundleIdentifier": "com.nfccard.tap" },
"android": { "package":          "com.nfccard.tap" }
```

```bash
npx expo prebuild --clean
```

Verified across both generated projects:

|                                       | Before                         | After                    |
| ------------------------------------- | ------------------------------ | ------------------------ |
| iOS `PRODUCT_BUNDLE_IDENTIFIER`       | `com.fasarticle.tapcard`       | `com.tapcard.app`        |
| Android `namespace` / `applicationId` | `com.fasarticle.tapcard`       | `com.tapcard.app`        |
| Android Kotlin source path            | `java/com/fasarticle/tapcard/` | `java/com/tapcard/app/`  |
| iOS `DEVELOPMENT_TEAM`                | `V993Z3KD7P`                   | `V993Z3KD7P` (unchanged) |
| NFC entitlement + usage string        | present                        | present                  |

`grep -rl "fasarticle\|tapcard\.app" android ios` → nothing. Note that **Android's Kotlin source directory tree
was physically regenerated** to match the new package (`MainActivity.kt`, `MainApplication.kt`
moved), which in a hand-managed Android project is a genuinely annoying refactor — package
declarations, directory layout, and Gradle config all have to agree.

This is the strongest CNG argument in the project so far, and a good one for the article:
renaming an app identifier is normally a multi-step, error-prone operation on _each_ platform —
Xcode project settings, entitlement re-provisioning, Android package refactor, manifest updates.
Here it was **two lines of JSON and one command**, because the native projects are build
artifacts rather than source. The cost of that convenience is the flip side we already paid in
§0.10: generated projects mean no hand-editing, and a lockfile that can drift.

_(The `withBuildScriptExtVersion` warning from §1.4 reappeared, as expected — it fires on every
`prebuild` and is still harmless.)_

### 1.9 The predicted signing failure, and why the error never mentions NFC clearly

§1.7 predicted the next iOS build would fail at code signing. It did, verbatim:

```
› Auto signing app using team(s): V993Z3KD7P
› Planning build
❌  TapCard/TapCard: Provisioning Profile "iOS Team Provisioning Profile: *" does not support the NFC Tag Reading capability.
❌  TapCard/TapCard: Entitlements file defines the value "com.apple.developer.nfc.readersession.formats" which is not registered for profile "iOS Team Provisioning Profile: *".

CommandError: Failed to build iOS project. "xcodebuild" exited with error code 65.
```

Note the profile name: **`iOS Team Provisioning Profile: *`** — the team _wildcard_. That single
asterisk is the whole story. With no explicit App ID registered, Xcode's automatic signing had
nothing better to match, fell back to the wildcard, and the wildcard structurally cannot carry a
special capability.

Xcode 26 is unusually clear here (older versions produced a generic "no profile matching" error),
but two things still mislead:

1. It reads as a _local_ problem — "entitlements file defines a value" sounds like our file is
   wrong. Our file is correct. The missing piece was on Apple's servers.
2. A second, unrelated error appeared **above** it from the previous attempt, and looks far more
   alarming than it is:

```
Build input file cannot be found: '/Users/fas/Library/Developer/Xcode/UserData/Provisioning Profiles/a33f753b-2889-4046-8a9a-dadae1fde876.mobileprovision'.
Did you forget to declare this file as an output of a script phase or custom build rule which produces it?
```

That UUID appears **nowhere in the project** (`grep -rn a33f753b ios/` → nothing). It was a stale
profile Xcode had cached and then replaced. The suggested fix ("declare this file as an output of
a script phase") is a complete red herring — nothing in our build produces provisioning profiles.
Worth including in the article as a lesson in reading Xcode errors: check whether the file it
names is something _you_ own before acting on the advice.

**Resolution — register an explicit App ID.** In the Apple Developer portal, team Recdek Ltd
(`V993Z3KD7P`): Identifiers → ＋ → App IDs → App → Bundle ID **Explicit** = `com.nfccard.tap`,
tick **NFC Tag Reading**, Register. Xcode then generated a matching profile on its own.

Verifying it from the command line rather than trusting the UI — useful because the profile is a
CMS-signed blob, not readable text:

```bash
PROF=~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/<uuid>.mobileprovision
security cms -D -i "$PROF" > /tmp/prof.plist
plutil -extract Entitlements xml1 -o - /tmp/prof.plist
```

```xml
<key>application-identifier</key>
<string>V993Z3KD7P.com.nfccard.tap</string>
<key>com.apple.developer.nfc.readersession.formats</key>
<array>
  <string>NDEF</string>
  <string>TAG</string>
  <string>PACE</string>
</array>
```

Note Apple granted **`PACE`** as well, a superset of the `[NDEF, TAG]` our entitlements file
requests. A profile may carry more than the app asks for; it must not carry less.

_(Gotcha while checking this: `plutil -extract` treats dots as key-path separators, so
`-extract Entitlements.com.apple.developer.nfc...` silently returns nothing — it goes looking for
nested keys named `com`, `apple`, `developer`. It reads as "the entitlement is missing" when it is
present. Extract the whole `Entitlements` dict instead.)_

Also confirmed the profile actually covers the test device before rebuilding — a profile can be
valid and still not include the phone in your hand:

```bash
plutil -extract ProvisionedDevices xml1 -o - /tmp/prof.plist | grep -c 00008110-001E2D6E02EA401E   # 1
```

**The article point.** On Android, adding NFC is one manifest line and you are done. On iOS the
same feature needs: an entitlements file (generated), an App ID registered in a web portal, a
capability ticked on that App ID, a regenerated provisioning profile, and a paid membership for
any of it to exist — and if you miss the portal half, the failure surfaces as a **code-signing**
error that never says the word "NFC" in a way that points you to a website. The local
configuration is necessary but not sufficient, and the error message does not tell you which half
is missing.

---

## ⏸ Paused 2026-08-22 — waiting on hardware

Phase 1 is code-complete and the iOS build is signed, built and installed on the test device, but
**the Phase 1 gate cannot be closed: the NFC chips were lost.** Replacements are expected around
2026-08-29.

Nothing is blocked on code. Static verification is green — `tsc`, ESLint, Prettier clean,
`expo-doctor` 21/21, both platforms bundling to Hermes bytecode — and the app runs on iPhone "Fas".
What is missing is the only thing that cannot be faked: a physical tag.

Worth stating plainly for the article, because it is the defining constraint of NFC work rather
than an inconvenience: **there is no simulator path.** NFC does not exist on the iOS Simulator or
the Android emulator. No amount of unit testing, mocking or CI substitutes for holding a chip
against a phone. Every claim in PLATFORM-NOTES.md that is marked ⏳ is marked that way precisely
because we refuse to write down behaviour we have not observed on hardware.

Two data points the comparison document is explicitly waiting on:

1. Blank-tag readout per platform — id, tech types, and **max size** (the NTAG213 ~144-byte figure
   that drives Phase 3's vCard capacity warning).
2. The verbatim error each platform produces when the user cancels a scan. Phase 1 renders raw
   errors on purpose so that Phase 2's error UX is designed around observed behaviour rather than
   assumption.

Also deliberately deferred: `expo-doctor` reports
`Untested on New Architecture: react-native-nfc-manager`. This is accurate and already understood
(§1.1 — legacy bridge module, no `codegenConfig`, running through RN's TurboModule interop layer).
Rather than leave a permanently red check for a future session to re-investigate, the acceptance is
now explicit in `package.json`:

```json
"expo": { "doctor": { "reactNativeDirectoryCheck": { "exclude": ["react-native-nfc-manager"] } } }
```

Suppressing a warning is normally the wrong instinct. It is defensible here only because the
underlying fact is documented, understood, and is itself the motivation for Phase 4 — and the
exclusion names the single package rather than disabling the check. Worth showing the reasoning in
the article, not just the config line.

Resume instructions live in `NEXT-SESSION.md` (working state, not article material).

---

## ▶ Resumed 2026-09-05 — the chips arrived

Two weeks of hold, ended by a padded envelope. Everything below is the first Phase 1 data
observed on real hardware.

### 1.10 What rots while a project sits still

Before any NFC work, the environment had to be rebuilt — and the shape of the rot is worth
recording, because it is the normal cost of pausing a React Native project rather than a fault.

`node_modules/` and `ios/Pods/` were both gone, cleared by the disk-space cleanup that recovered
the machine from 97% full during Phase 0. `pnpm install` restored the JS side in **4.4 seconds**
with zero downloads — every package came from the content-addressed store, and `pnpm-lock.yaml`
was unchanged, which is the whole argument for committing a lockfile. `tsc --noEmit` was clean
immediately.

`ios/Pods/` is the asymmetric half again (§0.10, PLATFORM-NOTES §1): restoring it requires a
separate `pod install`, and `ios/Podfile.lock` survived, so the next iOS build re-resolves from a
lockfile that is still correct for 57.0.15. Android needs no equivalent step at all — Gradle
re-resolves from `node_modules` every build, so restoring `node_modules` restored Android's native
dependency graph too, for free. **Two ecosystems, one command versus two.**

Expo also offered `57.0.15 → ~57.0.20` on startup. Declined deliberately: taking an SDK patch bump
immediately before a hardware gate is exactly the move that cost three build attempts in §0.9–0.10,
because a JS-only version change silently invalidates `Podfile.lock`. The upgrade is fine — the
timing would not be. **Do not change the build inputs on the day you finally get to test the
build.**

One environment note with no NFC content but real cost: `npx expo start` refused to start because
port 8081 was held by an unrelated project's Metro instance, and in a non-interactive shell its
"use 8082 instead?" prompt has nothing to answer it, so it exits 1 with `Skipping dev server`.
Second time this project has been bitten by Expo's interactivity assumptions (§0.11 was the `| tee`
one).

### 1.11 The iOS Phase 1 gate — the sheet appeared

`npx expo start --dev-client`, opened TapCard on iPhone "Fas" (iPhone 13 Pro, **iOS 26.5**), Read
tab, **Scan a tag**.

Apple's system NFC sheet slid up. That single fact closes the thread that has been open since
§1.7: **the sheet is drawn by CoreNFC and CoreNFC will not draw it for an app whose provisioning
profile lacks NFC Tag Reading.** Two weeks earlier this same code path died at build time with
`Provisioning Profile "iOS Team Provisioning Profile: *" does not support the NFC Tag Reading
capability`. The explicit `com.nfccard.tap` App ID registered in the Recdek portal (§1.9) is what
changed, and the sheet rendering is the proof it worked. Nothing in the local project is different
in kind — the fix lived on Apple's servers.

Confirmed the build under test was the right one before trusting any of this, since the rename in
§1.8 left two identically-named **TapCard** icons on the phone:

```bash
xcrun devicectl device info processes --device Fas | grep TapCard
# 947  /private/var/containers/Bundle/Application/4AA2E5CA-…/TapCard.app/TapCard
xcrun devicectl device info apps --device Fas --json-output /tmp/apps.json
# com.fasarticle.tapcard  → …/7B3B3CD9-…/TapCard.app/
# com.nfccard.tap         → …/4AA2E5CA-…/TapCard.app/
```

The running container matched `com.nfccard.tap`. Worth writing down as a technique: after an
identifier rename, the app **name** no longer identifies the build, and the bundle-container UUID
is the only thing that does.

**And a correction to our own prediction.** `NEXT-SESSION.md` expected the sheet to display
_"TapCard uses NFC to read and write your digital business card to a tag."_ It does not. It shows:

> **Ready to Scan**
> Hold your iPhone near the NFC tag.

Those are two different strings from two different places, and we had conflated them:

| String                                                                      | Where it is set                                                    | Where iOS shows it                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| `"TapCard uses NFC to read and write your digital business card to a tag."` | `NFCReaderUsageDescription`, via the plugin in `app.json`          | **Never in the scan sheet.** A privacy-manifest string |
| `"Hold your iPhone near the NFC tag."`                                      | `alertMessage`, passed to `requestTechnology()` at `lib/nfc.ts:88` | The sheet body, on every scan                          |

`NFCReaderUsageDescription` is mandatory — the app will not launch a reader session without it —
but it is a declaration to Apple and to the privacy report, not user-facing copy. The string the
user actually reads is the one you pass per-scan, which means **it can differ per scan**, and Phase
3 should say "Hold your iPhone near the tag to write" rather than reusing the read copy. PLATFORM-
NOTES §2 has been corrected; it claimed the usage description was "shown in the system NFC sheet".

Good article material precisely because it is invisible without hardware: both strings are
configured, both are spelled correctly, the app works, and the documentation-shaped assumption
about which one appears is still wrong.

### 1.12 What iOS actually hands back: two fields

Held a factory-fresh NTAG213 to the **top edge** of the phone. The sheet showed its success
checkmark and the app rendered:

| Field        | Value            |
| ------------ | ---------------- |
| ID           | `04C4FC91DF2A81` |
| Type         | `(none)`         |
| Tech types   | `(none)`         |
| Max size     | `(unknown)`      |
| NDEF records | `0`              |

```json
{
  "id": "04C4FC91DF2A81",
  "tech": "mifare"
}
```

Three things to read out of that.

**The tag is what we ordered.** A 7-byte UID beginning `04` is NXP's manufacturer code and the
NTAG21x signature.

**`NDEF records: 0` is the good outcome, not a failure.** `requestTechnology(NfcTech.Ndef)`
_resolved_ rather than throwing, which means the chip is already NDEF-formatted and simply carries
an empty message. §1.6 flagged the risk that factory-fresh tags arrive **unformatted**, in which
case the `Ndef` technology request fails outright and Android reports `NdefFormatable` instead.
These chips ship pre-formatted, so that path stays untested for now — Phase 2 must still handle it,
but it is no longer blocking.

**The important result is everything absent.** `(none)` and `(unknown)` are not nulls being
prettified: the raw dump is the entire object, and `type`, `techTypes` and `maxSize` are simply
**not present as keys**. iOS returns two fields. `tech: "mifare"` is CoreNFC's family
classification — NTAG is NXP's MiFare Ultralight line — and is not the same thing as Android's
`techTypes` array.

> ⚠️ **Corrected in §3.1.** The paragraph below concluded that capacity is unobtainable on iOS.
> That inference was wrong — `ndefHandler.getNdefStatus()` reports it, and a real NTAG213 answered
> **137 bytes** on 2026-09-05. The _observation_ here (that `getTag()` returns two fields) stands;
> the conclusion drawn from it did not. Left in place rather than edited away, because how the
> mistake was made is the more useful part.

This has a direct design consequence, and it is the first time the platform gap has changed a
product decision rather than a build step: **the NTAG213 ~144-byte capacity figure that was meant
to drive Phase 3's vCard size warning cannot be obtained from iOS.** There is no `maxSize` to read.
So Phase 3 must pick one of:

1. Capacity warnings on Android only — honest, but a worse experience on the platform that has the
   stricter session model.
2. Derive capacity from the tag type, i.e. maintain our own UID-prefix → capacity table. Works
   offline, but it is a hardcoded lookup that silently rots as new chips ship.
3. Read the NTAG capability container (page 3) ourselves over a MiFare command. Correct and
   general, but it means dropping below the NDEF abstraction into raw APDU-ish territory —
   and that is Phase 4's native-module argument arriving on its own.

Unresolved deliberately; Phase 3 decides with the Android numbers in hand.

### 1.13 The cancel error that renders as nothing

Second half of the gate: tap **Scan**, then **Cancel** on the system sheet. Expected a raw error
string to write down. Got **no error at all** — the UI returned to its default state as if nothing
had happened.

That is a bug in our screen, and a good one, because the cause is a design decision in the library
rather than a mistake in either place.

The promise does reject. On cancel, CoreNFC returns the string `NFCError:200`, and the library
parses it:

```js
// node_modules/react-native-nfc-manager/src/NfcError.js:113
} else if (code === NfcErrorIOS.errCodes.userCancel) {
  return new UserCancel();
}
```

`UserCancel extends NfcErrorBase extends Error` (`NfcError.js:3,18`) and is constructed **with no
arguments**, so `err.message` is the empty string. Our handler does the idiomatic thing:

```ts
setError(e instanceof Error ? e.message : String(e)); // → ''
```

and `''` is falsy, so `{error && <View …>}` renders nothing. The scan unwinds through `finally`,
`scanning` goes false, and the screen looks untouched.

**The lesson is about the API shape, not the empty string.** These errors carry their meaning in
their _class_, not their message — a deliberate choice, and arguably the right one, since it makes
`instanceof` checks the intended interface and avoids string-matching on error text. But it breaks
the single most common error-handling reflex in JavaScript, `err.message`, and it fails _silently_:
no crash, no log, no empty box. Every one of the 24 error classes in that file behaves this way.

Phase 2 fixes it in two parts:

```ts
import { NfcError } from 'react-native-nfc-manager';

if (e instanceof NfcError.UserCancel) return; // not an error; user changed their mind
setError(e instanceof Error ? e.message || e.constructor.name : String(e));
```

The first line matters more than the second. **A user cancelling a scan is not an error condition**
and should not paint a red box — which is exactly what our Phase 1 screen would have done had the
message not been empty. The bug and the correct behaviour happened to coincide.

Falling back to `e.constructor.name` is the general fix for the rest: `Timeout`, `TagConnectionLost`
and `SystemBusy` are all equally nameless today and all need to say something.

**A rare symmetry, worth noting because this document is mostly asymmetries.** Android reaches the
same class by a different route — the native side returns the literal string `'cancelled'`:

```js
// node_modules/react-native-nfc-manager/src/NfcError.js:141
export function buildNfcExceptionAndroid(error) {
  if (error === 'cancelled') {
    return new UserCancel();
  }
```

So `instanceof NfcError.UserCancel` is genuinely cross-platform, even though `NFCError:200` and
`'cancelled'` share nothing. The library's abstraction is doing real work here — one of the few
places so far where it hides a difference instead of leaking one. Pending confirmation on hardware
when the Android phone is available.

### Phase 1 gate — status

| Gate item                    | Status                                                   |
| ---------------------------- | -------------------------------------------------------- |
| iOS — entitlement live       | ✅ system sheet renders                                  |
| iOS — read a real tag        | ✅ `04C4FC91DF2A81`, NDEF-formatted, empty               |
| iOS — cancel behaviour       | ✅ observed (silent; `UserCancel` with an empty message) |
| Android — build since rename | ⛔ no physical Android device currently available        |
| Android — read / cancel      | ⛔ blocked on the same                                   |

**iOS half of Phase 1 is closed.** The Android column throughout PLATFORM-NOTES stays ⏳ until a
device is on hand; nothing in this project gets written down as observed until it has been.

---

## Phase 2 — Reading a tag properly

Phase 1 proved we could get bytes off a tag. Phase 2 turns those bytes into something a person can
read, and — unexpectedly — became the phase where we stopped trusting the library.

Every line of this phase was written with **no Android device available** and only a blank NTAG213
to hand. That constraint shaped the architecture more than any preference did.

### 2.1 The decision: hand-roll the decoder

`react-native-nfc-manager` bundles an `Ndef` helper with `uri.decodePayload()`,
`text.decodePayload()` and friends. Using them is about twenty lines. Writing our own is about two
hundred and fifty. We wrote our own, and the deciding argument was not code quality.

**It is the only part of the phase that is testable without hardware.** A decoder is bytes in,
string out — pure functions, no native modules, no device. With the Android phone unavailable,
hand-rolling converted a blocked phase into an unblocked one. `lib/ndef.ts` therefore imports
_nothing_ from react-native; the single import is `import type { NdefRecord }`, which is erased at
compile time.

The second argument arrived after the decision, while writing the tests, and turned out to be
stronger: two of the library's four decoders are wrong.

### 2.2 What an NDEF record actually is

Worth stating plainly, because the format is much smaller than its reputation.

A record has a **TNF** (Type Name Format — three bits saying how to read the type field), a
**type**, and a **payload**. Everything else is conditional on the TNF. Two payload layouts carry
almost all real-world traffic.

A **URI** record:

```
04 65 78 61 6d 70 6c 65 2e 63 6f 6d
│  └──────── "example.com" ────────┘
└─ prefix index → URI_PREFIXES[0x04] = "https://"

→ "https://example.com"
```

The first byte indexes a 36-entry table defined by the NFC Forum. `https://` costs **one byte**
instead of eight. On a tag with ~144 usable bytes that is not a micro-optimisation, and it is the
single most elegant idea in the format.

A **Text** record:

```
02 65 6e 48 69
│  └─┬─┘ └─┬─┘
│   "en"  "Hi"
└─ status byte:
     bit 7    encoding  0 = UTF-8, 1 = UTF-16
     bit 6    RFU       must be zero
     bits 5-0 length    bytes of IANA language code that follow
```

Three fields packed into one byte, then the language code, then the text.

Our decoder dispatches on TNF and produces a discriminated union rather than a bag of optional
fields, so a screen physically cannot read `.uri` off a text record — the compiler refuses:

```ts
export type NdefView =
  | { kind: 'empty' }
  | { kind: 'uri'; uri: string }
  | { kind: 'text'; text: string; lang: string; encoding: TextEncodingName }
  | { kind: 'mime'; mime: string; text?: string; bytes: number[] }
  | { kind: 'aar'; packageName: string }
  | { kind: 'unknown'; tnf: number; type: string; payload: number[] };
```

`unknown` always carries `tnf`, `type` and `payload`, because a reader that silently drops records
it does not understand is worse than one that admits it.

### 2.3 Reading the dependency instead of trusting it

Three defects, all found by reading `ndef-lib/` before writing anything, all confirmed with
executable tests.

**One — the Text decoder throws away the language code.**

```js
// ndef-lib/ndef-text.js
var languageCodeLength = data[0] & 0x3f; // 6 LSBs
// languageCode = data.slice(1, 1 + languageCodeLength),
// utf16 = (data[0] & 0x80) !== 0; // assuming UTF-16BE

// TODO need to deal with UTF in the future
```

It computes the length, uses it to skip forward, and the line that would _keep_ the language code
is commented out. Its `decodePayload` returns a bare string, so a caller cannot recover the
language at all. "Which language is this text in" is precisely the question a record with a
language field exists to answer.

**Two — the same function ignores the UTF-16 flag.** That `TODO` is load-bearing. A UTF-16 text
record is decoded as UTF-8 regardless, producing interleaved NUL characters.

**Three — the shared byte-to-string helper truncates above U+FFFF.**

```js
// ndef-lib/util.js
str += String.fromCharCode(ch);
```

`String.fromCharCode` takes the low 16 bits. Verified from the CLI before writing a line of our
own:

```
bytes    : 68 69 20 f0 9f 98 80
expected : hi 😀
library  : "hi " codepoints: 68 69 20 f600     ← U+F600, Private Use Area
match    : false
cjk lib  : "日本" (3-byte seqs are fine)
```

U+1F600 became U+F600 — an invisible Private Use Area character. Three-byte sequences (Arabic,
CJK) are unaffected; the bug is specific to astral planes. `String.fromCodePoint` is the fix.

**And its URI decoder is completely fine** — eight lines, correct, including the reserved-index
case. That asymmetry is the interesting part: this is not a bad library, it is a library with two
stale corners, and the only way to know which is which was to read it.

### 2.4 Tests as the argument, not just the safety net

`lib/ndef.test.ts` is in three groups, and the split carries the reasoning.

**Correctness** — our decoder against hand-built payloads.

**Agreement** — twelve real URIs encoded by _the library_ and decoded by _us_, asserted equal both
to the original string and to the library's own output, then the same across all 36 prefix
indices. If our table or our offset were wrong anywhere, these part company immediately. This is
the cheap way to be confident about a lookup table you typed out by hand.

**Divergence** — four _characterisation_ tests that assert the library is wrong:

```
✓ the library discards the language code; we keep it
✓ the library truncates 4-byte UTF-8; we do not
✓ both handle 3-byte sequences — the bug is specific to astral planes
✓ the library ignores the UTF-16 flag; we honour it
```

Asserting that a dependency is broken looks perverse, so it is worth defending. These tests
document _why `lib/ndef.ts` exists_, and they fail the day the library is fixed — which is exactly
when we should reconsider hand-rolling. A comment saying "the library is buggy" rots in silence; a
test saying it cannot. The emoji test asserts the _specific_ wrong answer
(`codePointAt(0) === 0xf600`) rather than merely "different from ours", so it stays meaningful if
upstream changes to a different kind of wrong.

One practical note for anyone copying this pattern: the library's decoders are imported from
`ndef-lib/*` **directly**, not through the package entry point. That subtree is dependency-free
CommonJS, so the tests never load `NativeModules`.

### 2.5 The undeclared peer dependency, for the third time

`pnpm test` failed on the very first run:

```
The React Native Jest preset that jest-expo relies on has moved to a separate package.
To migrate, please install "@react-native/jest-preset" to fulfill jest-expo's peer dependency.
```

`jest-expo` needs it; nothing _declares_ it; the installer never fetched it. This is the third
occurrence of one pattern in this project — `@expo/log-box` (§0.4), `@expo/metro-runtime` (§0.9),
now `@react-native/jest-preset`. Three times is a rule, not an anecdote: **in the Expo ecosystem,
a package being required at runtime does not mean any manifest asks for it.** Fixed by pinning it
by hand to the installed React Native version.

### 2.6 A smaller trap: test globals and `tsc`

`@types/jest` was installed and `tsc` still could not find `describe`. The obvious fix is
`"types": ["jest"]` in `tsconfig.json` — and it is a trap, because that field _replaces_
TypeScript's automatic `@types` discovery rather than adding to it. We would then have to
enumerate `react` and `node` by hand forever, and the next missing one would fail confusingly.

Test files import their globals instead:

```ts
import { describe, expect, it } from '@jest/globals';
```

Test types stay in test files and the app's namespace stays clean.

### 2.7 The error mapper, and where it had to live

Phase 1 (§1.13) established that every one of the library's 24 error classes is constructed with no
arguments, so `err.message` is always `''`, so `{error && <Card/>}` renders nothing. The fix is to
classify on the **class**.

Two constraints changed the design.

**It cannot live in `lib/nfc.ts`.** Importing `react-native-nfc-manager` at the package root builds
a `NativeEventEmitter` at module load and throws outside a native runtime:

```
at new NativeEventEmitter (react-native/Libraries/EventEmitter/NativeEventEmitter.js:57)
at Object.<anonymous> (react-native-nfc-manager/src/NativeNfcManager.js:5)
```

Anything importing it is untestable without heavy mocking. So the mapper is its own module,
`lib/scanError.ts`, importing only `react-native-nfc-manager/src/NfcError` — which depends on
nothing but `Platform`. Metro and Node both key their module cache on the resolved path, and the
package's own index imports that same file, so `instanceof` still matches errors the library
actually throws. The deep import needed a hand-written `.d.ts`, which `tsc` caught and jest did
not: **the two checks found different problems, and the suite was green while the types were not.**

**Classification uses `instanceof`; display uses hardcoded strings.** Class names are not
guaranteed to survive minification in a release build, so `constructor.name` would quietly start
reporting `a` instead of `UserCancel`. There is a test that mangles a class name to prove the
developer detail survives it.

Ten classes map onto eight kinds, each with a title and one actionable sentence. Everything except
`cancelled` is flagged `provisional: true` — derived from reading source, not from watching it
happen on a device. That flag is surfaced in the collapsed developer detail and tracked in
PLATFORM-NOTES.

And the behavioural fix that matters more than the wording:

```ts
if (isCancellation(e)) return; // a cancellation is not a failure
```

Phase 1 would have painted a red card at someone who simply changed their mind, and only avoided it
by accident because the message was empty. The bug and the correct behaviour happened to coincide.

### 2.8 Making the platform gap visible in the product

The strongest finding of Phase 1 was that iOS returns two fields from `getTag()` — `{ id, tech }` —
with no `maxSize`, so the NTAG213 capacity figure is unobtainable on that platform (§1.12).

Phase 2 stops treating that as a footnote in a document and puts it on a screen. `lib/tagFacts.ts`
models a fact with a **third state**:

```ts
type Fact = {
  label: string;
  value: string | null; // null = the platform did not report it
  unavailable?: string; // why, in plain language
  footnote?: string; // what we intend to do about it
};
```

A UI that renders "—" for both an absent value and a zero teaches nothing. So the capacity row is
_kept_ when empty, because its emptiness is the finding:

|          | Android                     | iOS                                                                                    |
| -------- | --------------------------- | -------------------------------------------------------------------------------------- |
| Capacity | `144 bytes`                 | **Not reported**                                                                       |
|          | Reported by the tag itself. | _(Corrected in §3.1: iOS reports it too, via `getNdefStatus()` — 137 bytes measured.)_ |
|          |                             | _Phase 4 reads it from the tag's capability container instead._                        |

Same physical chip. The reader can point at the row. This is the clearest argument yet for the
Phase 4 native module, and it is made by the product rather than by the prose.

The Android column above is **constructed from the documented API, not observed** — no Android
device has been available since the identifier rename. The test fixture says so in a comment, and
PLATFORM-NOTES keeps it ⏳. A green test must not quietly become evidence.

One thing deliberately left out: inferring the chip type from the UID prefix (`04` = NXP). That is
tempting and easy, and it is exactly the hardcoded lookup table that silently rots as new chips
ship. Logged as a nice-to-have, to revisit alongside Phase 4.

### 2.9 What Phase 2 shipped

|                        |                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `lib/ndef.ts`          | Hand-rolled decoder: TNF dispatch, URI prefix table, Text status byte, UTF-8 and UTF-16 |
| `lib/tagFacts.ts`      | Platform-aware facts with an explicit "not reported" state                              |
| `lib/scanError.ts`     | 10 error classes → 8 kinds, with provisional flags                                      |
| `store/tag.ts`         | Zustand's first real use in this project; records decoded once, on write                |
| `app/(tabs)/index.tsx` | Lean Read screen: decoded summary card, silent cancel, real error copy                  |
| `app/tag.tsx`          | Tag Info: identity, the capacity row, per-record bytes, raw JSON                        |
| `components/`          | `Collapsible`, `ErrorCard`                                                              |
| Tests                  | **106**, five suites, 0.66s, zero hardware                                              |

Verification: `tsc` clean, ESLint clean, Prettier clean, both platforms exporting to Hermes
bytecode (android 3.8 MB, ios 3.6 MB). `expo-doctor` is **20/21** — the one failure is upstream
SDK patch drift that accumulated during the hardware pause, and none of Phase 2's additions appear
in it.

**Still open, and blocked on an Android device:** every Android column in PLATFORM-NOTES, the
`not-ndef` error shape on a genuinely unformatted tag, and confirmation that Android's cancel maps
to `UserCancel` the way its source implies.

---

## Phase 3 — Writing

Phase 2 made a tag readable. Phase 3 puts something on one, and it is the first phase where a
mistake is not recoverable by re-running the code — a write replaces what was there.

It is also the phase where the project's central finding turned out to be wrong.

### 3.1 The correction: iOS reports capacity after all

Phases 1 and 2 said, repeatedly and in three documents, that **iOS cannot report tag capacity**.
That claim was wrong, and the shape of the error matters more than the fact.

What was _observed_ (§1.12): `getTag()` on iPhone "Fas" returned exactly two fields,
`{ id, tech }`. That remains true.

What was _concluded_: that the platform therefore cannot answer the question at all, that the
NTAG213 capacity figure is unobtainable from JavaScript on iOS, and that closing the gap requires
a native module. **None of that follows from the observation.** One API's silence is not a
platform limitation.

The counter-evidence was in the library the whole time:

```objc
// node_modules/react-native-nfc-manager/ios/NfcManager.m:539
[ndefTag queryNDEFStatusWithCompletionHandler:^(NFCNDEFStatus status, NSUInteger capacity, NSError *error) {
```

`ndefHandler.getNdefStatus()` calls that, and it needs an `NFCTagReaderSession` — which is exactly
what `requestTechnology` already opens (`ios/NfcManager.m:295`). The capability was one call away
from code we had been running since Phase 1.

Confirmed on hardware, 2026-09-05, real NTAG213 on iPhone "Fas":

```
WritePreflightError: too-big
tag reported status 2, 137 bytes
needed 202 bytes
```

`status 2` is `ReadWrite`, so **writability is knowable on iOS too** — another thing PLATFORM-NOTES
had recorded as Android-only.

**The generalisable lesson, and the reason this is written up rather than quietly patched:** the
project's own rule was "nothing is written down as fact until it is observed on a device". That
rule was followed for the observation and abandoned for the inference built on top of it. An
unverified _conclusion_ is exactly as dangerous as an unverified _measurement_, and it is harder
to notice, because it arrives wearing the credibility of the real data underneath it.

### 3.2 137, not 144 — the assumption was wrong twice

The reported number was not the one we had assumed either.

We had used **144 bytes**: the NTAG213's user memory, 36 pages of 4, pages 4–39. That is a real
figure about the chip. It is simply not an answer to the question being asked. What a writer needs
is the maximum **NDEF message**, which is smaller by the tag's own bookkeeping — and the tag says
so directly: **137**.

So the assumption was seven bytes too generous, in the dangerous direction: it would have told a
user their card fits when it does not.

Worse, the model had a second error that the first one hid. `assessCapacity` was adding the TLV
framing to the message _and_ comparing that total against raw user memory:

```
required = message + TLV        compared against 144   ← double-counting
```

Both a reported capacity and a corrected assumption are already message sizes with the framing
taken out. The fix is that every budget in the app now measures the same thing, and the TLV
overhead is shown for interest rather than added:

```
required = message              compared against 137
```

The TLV itself is still worth knowing, because it explains where the bytes go:

```
03 <length> <message bytes…> FE
│  │                          └─ Terminator TLV
│  └─ 1 byte, or 3 (FF + 16-bit) once the message hits 255
└─ 03 = NDEF Message
```

`NTAG213_NDEF_BYTES = 137` is now documented as **measured, not read off a datasheet**, and a test
asserts the value so a future edit cannot quietly restore the old number.

### 3.3 The bug that hid the finding

The measurement was available a session earlier and we could not see it, because of a small design
mistake worth its own paragraph.

`writeNdef` queries the tag before writing, and refuses if the message will not fit. The first
version threw the library's own error to do it:

```ts
if (queried?.capacity != null && bytes.length > queried.capacity) {
  throw new NfcError.TagSizeTooSmall(); // wrong: indistinguishable from CoreNFC's
}
```

So when the vCard write failed, the developer detail said `NfcError.TagSizeTooSmall` — and that is
exactly what CoreNFC would have produced if it had rejected the write itself. **Our refusal and the
tag's refusal were the same string**, which meant the failure could not tell us whether a capacity
had been reported at all. The one question we were trying to answer was the one the error had
erased.

The fix is a class of our own, carrying what the tag actually said:

```ts
export class WritePreflightError extends Error {
  constructor(
    readonly reason: 'read-only' | 'too-big',
    readonly reported: { status: NdefStatusValue; capacity: number | null },
    readonly needed: number
  ) { … }
}
```

That is also better product behaviour. Instead of "The tag does not have room", the card now reads
_"The tag reports 137 bytes and this needs 202. Nothing was written."_ And it is the only error in
the app with `provisional: false` on the write path, because we watched our own code decide it
rather than inferring the mapping from someone else's source.

**Reusable rule:** never throw a dependency's error type from your own logic. It collapses "we
refused" and "they refused" into one signal, and you will want to tell them apart precisely when
something is going wrong.

### 3.4 Asking the tag before writing to it

The write is one session doing four things:

```
requestTechnology(Ndef)
  ├─ 1. getNdefStatus()      is it writable, and how big is it really?
  ├─ 2. refuse early         read-only, or genuinely too small
  ├─ 3. writeNdefMessage()
  ├─ 4. getNdefMessage()     re-encode, compare byte for byte
  └─ cancelTechnologyRequest()
```

**One session, not four**, and that is an iOS constraint rather than a style choice: every
`requestTechnology` puts a system sheet in front of the user, so doing this across separate
sessions would mean four sheets and four taps for one logical action. Android would not have
noticed the difference — the same asymmetry as §1.11, now shaping control flow rather than copy.

Step 2 is the safety property. A refusal _before_ the write leaves the tag untouched; a failure
_during_ one can leave it half-written. Ask first.

Step 4 exists because a write that reports success and did not happen is the worst outcome
available. The read-back re-encodes the records that come back and compares bytes. A mismatch is
**reported, never thrown** — the write did succeed, and "it worked but I could not confirm it" is
more useful than either silence or a fabricated failure.

Nothing in this project calls `makeReadOnly`. Locking is permanent and stays in Phase 5.

### 3.5 vCard, and three escaping mistakes in a row

`lib/vcard.ts` emits vCard **3.0** — not 4.0, which is cleaner but less universally accepted;
3.0 is what `text/vcard` means in practice and both OS importers take it without complaint.

The format is from the 1990s and it shows: backslash-escaped values, semicolon-delimited
structured fields, CRLF endings, and long lines folded with a break plus a space. Two details are
easy to get wrong in ways nothing complains about:

**Folding is measured in octets, not characters.** `line.slice(0, 75)` splits a two-byte character
down the middle and produces invalid UTF-8. `foldLine` walks by code point tracking byte cost.

**`N` is required by 3.0 and cannot be derived reliably.** Splitting a display name into
family/given is a heuristic that is wrong for Chinese and Hungarian names, for Spanish names with
two surnames, and for anyone with one name. We take the last token, document that it is a guess,
and rely on `FN` — which is what importers actually display — carrying the name exactly as typed.

The escaping produced three mistakes in ten minutes, all the same misunderstanding:

1. **In the implementation.** `.replace(/;/g, '\;')` — and `'\;'` in a JavaScript string literal
   is just `';'`, because an unknown escape silently drops the backslash. Semicolons were not being
   escaped at all. Caught by re-reading before running anything.
2. **In the test.** The expectation asserted the _unescaped_ result, so it failed against correct
   code — the identical footgun, in the opposite direction.
3. **In a different test.** `expect(vcard).not.toContain('N:')` — which can never pass, because
   `BEGIN:VCARD` contains `N:`. The mirror image is the dangerous one: written as `toContain`, it
   would have passed on every input including cards with no `N` field at all.

Worth stating plainly for the article: had the test been written first, it would have "confirmed"
the broken implementation. Test-first does not protect you when the test and the code share a
misunderstanding — and string escaping is a domain where they usually do.

### 3.6 The numbers, and what they argue

Every figure below is pinned by a test, so the article's arithmetic and the app's behaviour cannot
drift apart:

|                 | Message       | Verdict on a 137-byte NTAG213 |
| --------------- | ------------- | ----------------------------- |
| Short URL       | **20 bytes**  | fits, 117 spare               |
| Realistic vCard | **213 bytes** | 76 over                       |

That gap is the product decision Phase 3 puts in front of the user rather than making for them:

- A **URL** is tiny and universally handled — and completely dependent on something answering at
  the other end. A domain lapses and the card is dead.
- A **vCard** is the whole card, works with no network at all, and does not fit on the tags this
  project bought.

The Write screen shows both sizes on both segments so the comparison is visible without switching,
and the byte breakdown makes the arithmetic checkable rather than magic.

### 3.7 A correctness guard that looks like a loading spinner

`store/profile.ts` is the first thing in the project that must survive a relaunch, so AsyncStorage
finally does the job it has been installed for since Phase 0, through Zustand's `persist`
middleware.

The part worth copying is `hasHydrated`:

```tsx
if (!hasHydrated) return <Text>Loading your card…</Text>;
```

That is not a nicety. Reading AsyncStorage is asynchronous, so on the first frame the store
legitimately holds empty defaults — and a form rendered over those writes them straight back the
instant the user touches a field. Silent data loss, only on a cold launch, invisible in every
dev-cycle test because the store is already warm.

`partialize` also keeps the flag _out_ of storage, since persisting it would mean reading back
`true` before hydration had happened.

### 3.8 What Phase 3 shipped

|                          |                                                                   |
| ------------------------ | ----------------------------------------------------------------- |
| `store/profile.ts`       | 7 fields, persisted, with the hydration guard                     |
| `lib/vcard.ts`           | vCard 3.0: escaping, octet-safe folding, empty-field omission     |
| `lib/ndefEncode.ts`      | Encoder mirroring the Phase 2 decoder; longest-prefix compression |
| `lib/capacity.ts`        | Measured budget, reported-vs-assumed, honest copy                 |
| `lib/writeError.ts`      | Our refusal, distinguishable from the tag's                       |
| `lib/nfc.ts`             | `writeNdef` — query, refuse, write, verify, in one session        |
| `app/(tabs)/profile.tsx` | Editor with a live byte counter                                   |
| `app/(tabs)/write.tsx`   | URL/vCard choice, capacity verdict, preview, two-tap confirm      |
| Tests                    | **215**, ten suites, no hardware                                  |

`tsc`, ESLint and Prettier clean; `expo-doctor` 21/21; both platforms export to Hermes (android
3.9 MB, ios 3.7 MB).

**Verified on hardware:** a URL written to an NTAG213, read back inside the same session, read
again on the Read tab, and opened from Tag Info. A vCard refused before writing, with the tag's own
numbers in the refusal.

**Still blocked:** everything Android. And Phase 4's motivation has been re-scoped — see below.

### 3.9 What Phase 4 is for now

The capacity finding removed Phase 4's newest argument, and rather than quietly keeping the phase
on the plan, it was re-decided.

**Phase 4 is about owning the native layer, not about a gap in it.** Plenty of teams cannot take a
third-party dependency: internal-only policies, audit requirements, or simply a package they cannot
get a fix merged into on any useful timescale. "How would I build this myself?" is a question worth
answering on its own terms.

The evidence for it is already gathered, and it is ours rather than asserted — three defects found
by reading `react-native-nfc-manager` (§2.3: the discarded language code, the ignored UTF-16 flag,
emoji truncated to U+F600), `index.d.ts` that is invalid TypeScript (§1.2), and a package root that
throws outside a native runtime (§2.7). That is a concrete answer to "why would I write my own?"
that does not depend on any platform lacking a capability.

The asymmetry arguments that survive today untouched: `isNfcEnabled()` is unreachable by
construction on iOS rather than merely unasked, there is no settings deep-link on iOS, and the
library is a legacy bridge module running through RN's interop layer.

---

## Phase 4 — Writing the native module

Phases 1–3 were built on `react-native-nfc-manager`. Phase 4 replaces it with a module written by
hand in Swift and Kotlin, and ends with the dependency removed from `package.json`.

The reason changed partway through, and that is worth recording rather than tidying away.

### 4.1 The argument that did not survive contact with hardware

Phase 4 was originally justified by a capability gap: iOS could not report tag capacity, so a
native module was needed to read it from the tag directly. **That argument evaporated in §3.1** —
iOS reports capacity perfectly well through `queryNDEFStatus`, and the claim had been an inference
rather than an observation.

Rather than quietly keeping the phase on the plan with its motivation gone, it was re-decided.
Fas's framing, and it is a better one:

> in case someone prefers to build their own package, or the company is huge on doing things
> internally

That does not depend on any platform lacking anything. Plenty of teams cannot take a third-party
dependency at all — internal-only policies, audit requirements, or simply a package they cannot get
a fix merged into on a useful timescale. **"How would I build this myself?" is worth answering on
its own terms.**

And the evidence for _this particular_ dependency was already gathered, by us, by reading it:

| Finding                                                                  | Where |
| ------------------------------------------------------------------------ | ----- |
| Text decoder measures the language code's length, then discards the code | §2.3  |
| UTF-16 flag ignored — an open `TODO`                                     | §2.3  |
| `String.fromCharCode` truncates above U+FFFF: U+1F600 → U+F600           | §2.3  |
| `index.d.ts` is invalid TypeScript                                       | §1.2  |
| Package root throws outside a native runtime                             | §2.7  |
| All 24 error classes carry an empty `message`                            | §1.13 |

None of those are fixable from JavaScript, and none were discovered in production — they came from
reading the source before trusting it.

### 4.2 The scaffolding is no longer the hard part

```bash
npx create-expo-module@latest --local --name NfcNative \
  --package com.nfccard.tap.nfcnative -p apple android --features Function
```

Four files, autolinked by `pod install`, no Xcode project surgery, no `RCT_EXPORT_METHOD`, no
manual JSI. For anyone who last wrote a React Native native module in the bridge era, that is the
headline: **the ceremony is gone.**

Two snags, neither in the docs:

- `--name` sets the _native module_ name. The **directory** comes from a positional path argument,
  so without one it lands in `modules/my-module`.
- The generated podspec declares an iOS **16.4** floor. Ours matched (SDK 57's default), but a
  module can silently raise an app's minimum deployment target, and that is worth checking before
  it surprises someone.

### 4.3 What the library was hiding

The capabilities slice (T1) is four functions and proves the toolchain. The read session is where
the real work is, and it is worth showing in full because none of it is JavaScript-shaped.

**CoreNFC is delegate-and-callback based.** One read is four nested asynchronous steps — begin →
detect → connect → `queryNDEFStatus` → `readNDEF` — each with its own error, none returning
anything.

**A JavaScript promise must settle exactly once.** Every failure path therefore routes through a
single lock-guarded `settle()`. The subtlety that will catch people: a _successful_ read also
invalidates the session, so `didInvalidateWithError` fires **after** completion and would overwrite
the result. Guarded, not assumed.

**The session must be retained by the module, not the function.** A local variable is deallocated
on return, taking the CoreNFC session with it — and the system sheet vanishes with **no error at
all**. This is the single easiest way to get a CoreNFC integration subtly wrong, and nothing tells
you.

```swift
// Held for the life of the module, not the scan.
private var readSession: Any?
```

The write session adds two responsibilities that only exist because a write changes something: ask
the tag first (`queryNDEFStatus` for read-only status and real capacity, refusing _before_ anything
is sent), and verify afterwards by reading back inside the same session. **One session, not two** —
each `requestTechnology` puts a system sheet in front of an iOS user, so splitting them would mean
two sheets and two taps for one action.

Verification compares **record content, not raw bytes**: a tag may legally return a message whose
framing differs from what we sent while carrying identical data.

### 4.4 Ask only for what you can sign for

The first build that reached the phone failed at runtime with `Missing required entitlement`.

The cause was a single polling option. `NFCTagReaderSession` was opened with
`[.iso14443, .iso15693, .iso18092]`, and `.iso18092` — FeliCa — additionally requires
`com.apple.developer.nfc.readersession.felica.systemcodes`, which we do not hold. **Asking for it
fails the entire session, not just that polling mode.**

It had been added on the reasoning that a wider net would produce better errors for unexpected
tags. It produced a session that could not start at all. Narrowed to `[.iso14443, .iso15693]`, both
covered by the `TAG` format already in the entitlements.

The same lesson as §1.9 from the other direction: there, a missing entitlement surfaced as a
code-signing failure that never said "NFC". Here, an entitlement we never needed surfaced as a
runtime failure that never said "FeliCa".

### 4.5 Expo's error code is not your class name

The best bug of the phase, because 272 passing tests said nothing about it.

After switching the app to the native backend (T9), cancelling a scan rendered a red _"Could not
read the tag"_ card instead of nothing.

Our Swift throws `UserCancelledException`. The JavaScript mapping table was keyed on
`UserCancelledException`. Those do not match, because Expo derives the code:

```swift
// expo-modules-core/ios/Core/Exceptions/CodedError.swift:45
// strip trailing Error/Exception → split camelCase → uppercase → prefix ERR_
UserCancelledException  →  ERR_USER_CANCELLED
```

`describeNativeError()` prefers that code, the lookup missed, everything fell through to the
generic "unknown" card.

**Why the tests were silent is the part worth keeping.** Every test of that mapping used a fixture
written by hand:

```ts
const wrapped = (code, message) =>
  new Error(`Calling the 'readTag' function has failed → Caused by: ${code}: ${message}`);
```

No `code` property — because we did not know Expo set one. The code and its tests shared a single
wrong assumption and agreed with each other perfectly. **A fixture you invented can only prove your
code is self-consistent.** It took a thumb on a Cancel button.

The fix keeps the table keyed on the Swift class names we actually wrote and _derives_ the `ERR_`
forms with `expoCodeFor()`, mirroring Expo's algorithm — one source of truth instead of two lists
that drift. Matching tries both. The regression is now pinned by a test using the **verbatim device
error**, `code` property and all.

A related finding from T1, same shape: Expo wraps a native exception in a `FunctionCallException`,
so `err.message` is the framework describing its own plumbing and _your_ sentence is at the end of
the cause chain. This is the mirror image of §1.13 — there the message was empty, here it is buried
— and both break the same reflex. **Owning the native side does not exempt you from error plumbing;
it changes which layer surprises you.**

### 4.6 Proving the swap instead of asserting it

Before switching, both implementations read the same physical chip and the results were diffed
field by field (`lib/parity.ts`, and a screen to drive it).

The design decision that made it useful: **"different" is not one outcome.** Our read reports
capacity and writability that the library's read path does not carry, and scoring that as a
mismatch would be actively misleading. Five statuses:

| Status         | Meaning                                                |
| -------------- | ------------------------------------------------------ |
| `same`         | both reported it, they agree                           |
| `differs`      | both reported it, they disagree — **the only bad one** |
| `native-only`  | ours knows more — _the reason to switch_               |
| `library-only` | we lost something — **also blocks the swap**           |
| `neither`      | nothing to conclude                                    |

`library-only` blocking the swap matters: losing information is a real problem even though it is
not a contradiction.

Result on a real NTAG213, 2026-09-13: **4 fields identical, 2 reported only by our module,
0 conflicts.** That is the evidence the switch was made on.

### 4.7 Removing a dependency means inheriting its build configuration

The riskiest part of T10 was not code.

`react-native-nfc-manager` ships a **config plugin**, and that plugin was generating the iOS NFC
entitlement and `NFCReaderUsageDescription`. Remove the package and both vanish — **the app loses
NFC with no error at all.** Nothing fails at build time; the system sheet simply never appears
again.

So the order was: declare them explicitly in `app.json`, prebuild, verify the output is
byte-identical to the plugin's, _then_ remove the plugin, verify again, _then_ remove the package.

```json
"ios": {
  "infoPlist": { "NFCReaderUsageDescription": "TapCard uses NFC to …" },
  "entitlements": { "com.apple.developer.nfc.readersession.formats": ["NDEF", "TAG"] }
}
```

**Generalisable:** before deleting a dependency, check what its config plugin was doing for you. The
code it exports is the visible half.

### 4.8 Keeping the evidence after deleting the dependency

The argument for Phase 4 rests on defects in a package that no longer exists. Left alone, deleting
it would have turned an executable argument back into a claim in a document — and taken the
**agreement** tests with it, leaving a hand-typed 36-entry lookup table unverified.

So `vendor/react-native-nfc-manager/` holds a frozen copy of the two decoders and the error classes,
MIT licence included, with a README stating plainly that nothing imports it, that it exists as
evidence, and that it must never be "fixed" — its value is being wrong in the documented ways.
ESLint and Prettier ignore it, because reformatting would destroy the diff against upstream.

`lib/vendorEvidence.test.ts` asserts both findings directly. If a future version of the package
fixes any of them, those tests fail — which is the signal to re-open the question, not a nuisance.

### 4.9 What the swap actually bought

Not speed, and not lines of code — the module is more code than the dependency was.

**Capacity on every read.** The library reads it only during a write session, so its `getTag()`
never carries it. Tag Info showed "Not reported" for two phases; it now shows `137 bytes`. The Write
screen stopped guessing without needing a write first.

**Errors that carry a code _and_ a message.** The defect behind §1.13's silent failure is gone by
construction.

**A simplification we did not plan.** `lib/writeError.ts` existed so a JavaScript pre-flight refusal
could be told apart from CoreNFC's (§3.3). The pre-flight moved into Swift, and capacity now arrives
on every read, so the whole file became unreachable and was deleted.

**And the thing a team would actually be buying:** the next decoder bug is an afternoon's work
instead of an issue on someone else's tracker.

### 4.10 What Phase 4 shipped

|                               |                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `modules/nfc-native/ios/`     | `NfcNativeModule`, `NfcReadSession`, `NfcWriteSession`, `NfcTagInfo`, `NfcExceptions` |
| `modules/nfc-native/android/` | Capabilities over a real `NfcAdapter` — ⛔ compiled, never run                        |
| `lib/nfcBackend.ts`           | The single boundary every screen imports                                              |
| `lib/nativeError.ts`          | Unwraps Expo's cause chain; mirrors its code derivation                               |
| `lib/nfcTypes.ts`             | Types we own, with `ndefMessage` correctly optional                                   |
| `vendor/`                     | The removed dependency, frozen as evidence                                            |
| Removed                       | `react-native-nfc-manager`, `lib/nfc.ts`, `lib/writeError.ts`, and its config plugin  |

**Still open, all behind an Android device:** the Kotlin read path (T3), formatting (T6), a cancel
entry point for Android — where, unlike iOS, the app must draw its own way out — and every Android
column in PLATFORM-NOTES.

---

## Phase 5 — Locking a tag, permanently

Every earlier phase was reversible. A write replaces a tag's contents; you can always write
something else. This one burns the chip's lock bits — a hardware change. The tag can be read
forever and never written again, by any app, on any phone. There is no undo, no factory reset, and
no clever command that puts it back.

### 5.1 Why build it at all

Because it is what real deployments do. An event badge, a product-authentication seal, a museum
label — anything handed to the public — gets locked so the next person with a phone cannot
overwrite it. A tag you can rewrite is a tag anyone can rewrite.

It is also the honest end of the project: the one operation where getting the UX wrong destroys
something physical rather than producing an error you can read and retry.

### 5.2 The gate is the feature

The native call is four lines. `NFCNDEFTag.writeLock` on iOS, `Ndef.makeReadOnly()` on Android.
Everything interesting in this phase is what happens _before_ it.

Two taps guards a write, and two taps is right for a write — a write is reversible, you simply
write something else. It is plainly not enough here. So the gate borrows the pattern GitHub uses
for deleting a repository: **type the thing's name to prove you know which thing you are
destroying.**

That specific choice matters more than the friction it adds:

> A confirmation dialog measures willingness. Typing the identifier measures **attention**. The
> failure mode worth designing against is not someone who wants to lock a tag — it is someone who
> wants to lock a tag and is holding the wrong one.

Which is also why the screen refuses to arm until you have **read the tag first**, and shows what
is currently on it. An unintended chip announces itself before it can be spent.

`lib/lock.ts` holds the whole decision as a pure function, so the rules are tested without a device
and without destroying anything:

```ts
export function lockGate(tagId, status, typed): LockGate {
  if (!tagId) return { state: 'no-tag' };
  if (status === NDEF_STATUS.READ_ONLY) return { state: 'already-locked' };
  if (status === NDEF_STATUS.NOT_SUPPORTED) return { state: 'not-lockable' };

  return normaliseTagId(typed) === normaliseTagId(tagId)
    ? { state: 'armed', tagId }
    : { state: 'needs-confirmation', expected: tagId };
}
```

Order matters in that function. `already-locked` is checked **before** the typed confirmation, so
nobody can type their way into "locking" a tag that is already locked and be told it worked. It did
not work; there was nothing to do.

### 5.3 A test that was right while the code was wrong

One of the eleven tests was written as:

```ts
it('refuses a tag that is not NDEF at all', () => {
  expect(lockGate(TAG, NDEF_STATUS.NOT_SUPPORTED, TAG).state).toBe('armed');
});
```

The name says _refuses_; the assertion says _armed_. It passed, because the code did arm.

The name was right and the code was wrong. `writeLock` is a method on `NFCNDEFTag` — locking the
raw memory of a non-NDEF chip is a different operation against a different interface, and offering
it here would be claiming to do something we do not do. Fixed with a `not-lockable` state.

Worth recording because of how it was caught: not by a failing test, but by **reading a passing
test's name next to its assertion**. A test that agrees with the wrong code is invisible to a test
run.

### 5.4 Distinguishing "nothing to do" from "something went wrong"

`AlreadyLockedException` is deliberately separate from `LockFailedException`, on both platforms:

```swift
internal final class AlreadyLockedException: Exception {
  override var reason: String {
    "This tag is already permanently read-only. Nothing was changed."
  }
}
```

Collapsing them would tell a user something alarming about a tag that is in exactly the state they
asked for. The UI renders it **green**, with no lock button — because the correct response to
"already locked" is reassurance, not a retry affordance.

This is the same principle as §3.3's rule about never throwing a dependency's error type: two
different situations must not arrive as one signal, and the moment you want them apart is the
moment something is going wrong.

### 5.5 Verify, because you cannot retry to find out

Both implementations re-read the tag's status **after** the lock and report whether it actually
took. That check exists in the write path too, but it carries different weight here:

> A failed write is recoverable — write again. A lock that reports success and did not happen sends
> a tag into the world believing it is protected, and you cannot retry to find out, because
> **retrying is itself the destructive act.**

So an unverified lock is not reported as a soft warning the way an unverified write is. The copy
says the chip's state is unknown and to read it before relying on it.

### 5.6 A separate class, not a flag

`NfcLockSession` duplicates a fair amount of `NfcWriteSession` — the session setup, the delegate,
the settle-exactly-once discipline. That duplication is deliberate.

The alternative was a `lock: Bool` on the write session. A boolean parameter that sometimes
destroys the tag is exactly the kind of thing that gets passed by accident from a refactor three
months later, by someone who has never read this file. Two call sites, two intentions, no shared
branch that can be reached from the wrong place.

Sometimes the right response to "this is nearly the same code" is to let it be nearly the same
code.

### 5.7 Verified on hardware

2026-09-13, a nominated sacrificial NTAG213 on iPhone "Fas":

| Check                                                           | Result                               |
| --------------------------------------------------------------- | ------------------------------------ |
| Gate refuses a wrong or partial identifier                      | ✅ button stays disabled             |
| Gate arms on an exact match                                     | ✅                                   |
| Lock applies and self-verifies                                  | ✅ "Locked, and confirmed read-only" |
| Re-reading reports **Locked — read-only, permanently**          | ✅                                   |
| Locking again reports **Already locked**, in green, no button   | ✅                                   |
| Writing to it refuses in pre-flight with `TagReadOnlyException` | ✅ nothing sent to the tag           |

That last row is the one worth having. It proves the lock is a real hardware state CoreNFC reports
back — not a flag the app is remembering — and that the refusal happens _before_ a write is
attempted.

⛔ The Kotlin mirrors all of this and has never been run.

### 5.8 What Phase 5 shipped

|                                               |                                                    |
| --------------------------------------------- | -------------------------------------------------- |
| `lib/lock.ts`                                 | The gate and the verification rule, pure. 11 tests |
| `modules/nfc-native/ios/NfcLockSession.swift` | Ask → refuse → lock → verify                       |
| `NfcExceptions.swift`                         | `AlreadyLockedException`, `LockFailedException`    |
| Kotlin                                        | `Ndef.makeReadOnly()`, same shape ⛔               |
| `app/lock.tsx`                                | Read-first, type-to-arm, plain language            |

**293 tests**, `tsc`, ESLint and Prettier clean.

Deliberately not done: the **EAS build comparison** listed under Phase 5 in the README. It is a
separate piece of work with no NFC content, and belongs with the article's "how would I ship this"
material rather than here.

---

## Phase 5b — EAS, and the step it would have saved

Everything in this project was built locally: `expo run:ios`, Xcode, CocoaPods, a Gradle daemon,
and — twice — a completely full disk. EAS Build is the alternative, and it is worth an honest
comparison rather than a recommendation.

⚠️ **§5b.1–5b.3 were written from Expo's documentation, not from a build we ran.** §5b.4 onwards
is sourced from `eas-cli@22.0.0`'s code on disk, which is stronger; a real build is still pending an
interactive Apple login (§5b.5).

Until 2026-09-13 the project was deliberately **not linked** — §0.3 records skipping
`eas build:configure` because it creates a cloud project as a side effect, and that should be a
decision rather than a scaffold artefact. It has now been made deliberately: the user approved
linking and the build spend, so `app.json` carries
`extra.eas.projectId = 6c1efc31-c3a8-4349-b62d-12395719ee55` (`@fasdev/tapcard`) and pins
`owner: "fasdev"`. Claims below are marked by source.

### The setup we already had

```json
{
  "cli": { "version": ">= 22.0.0", "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": { "distribution": "internal" },
    "production": { "autoIncrement": true }
  }
}
```

Three profiles, written by hand in Phase 0 and unused until now. `eas-cli` 22.0.0 is installed and
authenticated as `fasdev` (Owner).

Two things the first `eas build` surfaced immediately, before it ever reached Apple:

- **`ITSAppUsesNonExemptEncryption` was missing**, which does not fail the build but leaves a manual
  export-compliance question blocking every submission in App Store Connect. Now declared `false` in
  `app.json` — accurate: TapCard ships no custom cryptography.
- **`appVersionSource: "remote"` had no remote versions**, so `buildNumber` was initialised to `1`
  from the local project. Expected, and worth knowing it happens silently on first use.

It then stopped exactly where it had to: _"Distribution Certificate is not validated for
non-interactive builds. Credentials are not set up. Run this command again in interactive mode."_
Apple login and 2FA cannot be automated, which is the honest boundary of this experiment.

### What this project would hand to EAS cleanly

**Continuous Native Generation is the ideal case.** `ios/` and `android/` are gitignored and
regenerated from `app.json`, so there is no native state to keep in sync — EAS prebuilds from the
same inputs we do. A project with committed native directories has a much harder time.

**A local module needs nothing special.** `modules/nfc-native/` lives in the repository and is
autolinked by path, so there is no package to publish and no registry involved. The Swift and
Kotlin travel with the commit.

**The vendored directory is inert.** `vendor/react-native-nfc-manager/` is imported by nothing but
a test file and excluded from lint and formatting, so it adds bytes to the upload and nothing else.

### The one that matters: capabilities sync

Phase 1's worst afternoon was this error:

```
Provisioning Profile "iOS Team Provisioning Profile: *" does not support
the NFC Tag Reading capability.
```

The fix was manual and undiscoverable from the message: register an explicit App ID in the Apple
developer portal, tick **NFC Tag Reading**, regenerate the profile. Nothing in the error suggests
opening a browser (§1.9).

**EAS does that step for you.** Per Expo's iOS capabilities reference, if a supported entitlement is
present in the entitlements file, `eas build` enables the matching capability on the Apple Developer
Console, and skips it when already enabled. `com.apple.developer.nfc.readersession.formats` —
exactly the key this app declares — is on the supported list by name.

So the single most painful manual step in the entire project is automated by the thing we did not
use. That is worth saying plainly rather than defending the local path.

### And the trap that comes with it

The sync runs in both directions:

> If a capability is enabled for your app remotely, but not present in the native entitlements file,
> running `eas build` will automatically **disable** it.

Which means a team that manages entitlements by hand in the portal _and_ builds with EAS will watch
EAS switch things off. The entitlements file becomes the source of truth whether you intended that
or not.

`EXPO_NO_CAPABILITY_SYNC=1` opts out — and Expo notes that opting out means remote changes stop
syncing, which can produce provisioning-profile mismatches later. Pick one owner for capabilities
and let it own them.

Note also that changing a capability invalidates existing provisioning profiles, so they need
regenerating afterwards. Locally that is a manual dance; on EAS it is part of the same run.

### What EAS would not have helped with

Worth being even-handed, because "use EAS" is not an answer to most of this project's pain:

| Problem                                        | Would EAS have helped?                                  |
| ---------------------------------------------- | ------------------------------------------------------- |
| NFC Tag Reading capability on the App ID       | ✅ automated                                            |
| Full disk, twice, at 460 GB                    | ✅ builds happen elsewhere                              |
| Gradle daemon holding memory after a build     | ✅ nothing runs locally                                 |
| `pod install` needed after adding a Swift file | ✅ every build is clean                                 |
| The deallocated CoreNFC session                | ❌ a code bug                                           |
| Settling a promise twice                       | ❌ a code bug                                           |
| The FeliCa polling entitlement                 | ❌ _not_ a capability — it is a key EAS does not manage |
| `String.fromCharCode` truncating an emoji      | ❌ a dependency bug                                     |
| Expo deriving `ERR_USER_CANCELLED`             | ❌ a wrong assumption                                   |
| Reading a tag at all                           | ❌ there is no cloud substitute for a chip              |

That last row is the honest summary. **EAS removes machine problems, not NFC problems.** Every
finding in this project that was actually about NFC would have happened identically.

### The trade, stated plainly

Local builds cost disk, memory and setup. This project filled a 460 GB disk **twice**, had three
background processes killed under memory pressure, and lost a full rebuild to a stale Gradle daemon.
The first Android build took 13 minutes 40 seconds cold.

EAS costs queue time and a cloud project, and moves your credentials to Expo's servers. It does not
shorten the loop that matters here: **you still have to walk to a phone and hold a chip against it.**
A cloud build that succeeds tells you nothing about whether the tag read.

For a solo project with a working local toolchain, local wins on iteration speed. For a team, or a
CI pipeline, or anyone who has just watched their disk hit 100% mid-build, the capability sync alone
is a strong argument.

**Still unverified**, and worth stating one more time: no EAS build was run for this project.

### 5b.4 — Reading the CLI instead of the docs (2026-09-13)

Before spending a build, I read `eas-cli@22.0.0` on disk rather than trusting the documentation
page. The mapping is a plain table, and NFC is in it verbatim
(`build/credentials/ios/appstore/capabilityList.js:284`):

```js
{
  // https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_developer_nfc_readersession_formats
  name: 'NFC Tag Reading',
  entitlement: 'com.apple.developer.nfc.readersession.formats',
  capability: CapabilityType.NFC_TAG_READING,
  // Technically it seems only `TAG` is allowed, but many apps and packages tell users to add `NDEF` as well.
  validateOptions: createValidateStringArrayOptions(['NDEF', 'TAG']),
  getSyncOperation: getDefinedValueSyncOperation,
}
```

Two things worth keeping:

1. **The allowed values are validated**, and they are exactly the two this project declares. The
   comment is an admission that `NDEF` is cargo-culted — _"technically it seems only `TAG` is
   allowed, but many apps and packages tell users to add `NDEF` as well."_ We inherited that pair
   from the library's config plugin in Phase 1 (§1.9) without knowing it was folklore.

2. **`getDefinedValueSyncOperation`** is the answer to "does it really disable things?" — the
   operation is driven by whether the key is _defined_ in the entitlements file, in both directions.
   The two-way sync is not a documentation footnote; it is how the function is written.

**Where the sync actually runs.** The docs say "when you run `eas build`", which implies a build is
required to observe it. Tracing the call chain says otherwise:

```
SetUpTargetBuildCredentials.runAsync()      actions/SetUpTargetBuildCredentials.js:19
  └─ ctx.appStore.ensureBundleIdExistsAsync({ entitlements, … })
       └─ syncCapabilitiesAsync()            appstore/ensureAppExists.js:104
            └─ syncCapabilitiesForEntitlementsAsync()
                 → "Synced capabilities: Enabled: … | Disabled: …"   (or "No updates")
```

`SetUpTargetBuildCredentials` is the credentials step, not the build step — so
`eas credentials:configure-build` triggers the identical sync **without consuming a build**. That
makes the experiment free, which changes what is worth testing.

Also confirmed in source: `EXPO_NO_CAPABILITY_SYNC` is read once
(`bundleIdCapabilities.js:12`) and short-circuits both the capability sync and the capability
_identifier_ sync. And the error path names the manual escape hatch directly — a link to the
Apple console page for that bundle ID, plus the env var.

### 5b.5 — The experiment, and why the obvious version proves nothing

Running EAS against `com.nfccard.tap` cannot demonstrate the headline claim. That App ID already
has NFC Tag Reading enabled — **we ticked it by hand in §1.9**, which is the afternoon this section
is about. The sync would report `No updates`, which is a true observation of agreement and a very
boring one.

So the decisive test needs a bundle identifier that has never existed. Set up as an isolated scratch
project (deliberately _not_ by editing TapCard's `app.json`, which would risk muddling the real
app's stored credentials):

- `com.nfccard.tap.eastest`, entitlements the only meaningful content
- its own cloud project, `@fasdev/eas-capability-test`
- `eas config` confirms the entitlement survives into the resolved build config

Expected: `Synced capabilities: Enabled: NFC Tag Reading` against a bundle ID nobody ever opened a
browser for.

### 5b.6 — Observed (2026-09-13, iPhone-free, both runs)

✅ **Both commands ran.** This section is no longer documentation-sourced.

**Run 1 — the real app, `com.nfccard.tap`:**

```
✔ Bundle identifier registered com.nfccard.tap
✔ Synced capabilities: No updates
✔ Synced capability identifiers: No updates
```

Exactly as predicted in §5b.5, and the prediction is the point: the App ID already carried NFC Tag
Reading because **we ticked it by hand in §1.9**. `No updates` is EAS confirming our manual work
was correct, including the `["NDEF", "TAG"]` pair, which passed `validateOptions` without complaint.
It proves agreement. It cannot prove automation.

**Run 2 — the scratch bundle ID, `com.nfccard.tap.eastest`, which did not exist:**

```
✔ Bundle identifier registered com.nfccard.tap.eastest
✔ Synced capabilities: Enabled: NFC Tag Reading
✔ Synced capability identifiers: No updates
```

**That is the claim, observed.** A bundle identifier registered from nothing and NFC Tag Reading
enabled on it, from the entitlements file alone, with no visit to the Apple Developer portal. The
manual step that cost an afternoon in §1.9 took one line of CLI output — and it cost **no build
credits**, because §5b.4 established the sync runs at the credentials step.

**The build itself succeeded**, first attempt:

- Build `fa88d8cb-02d4-4357-870a-07db60eaff2e`, artifact published as `.ipa`
- `buildNumber` incremented 1 → 2 — the `1` came from the failed non-interactive attempt, so
  `autoIncrement` counted an attempt that never reached Apple. Harmless; worth knowing.
- Distribution certificate `6B8619E46011CC763186AFE604B81C89`, provisioning profile `9KDR33S2FL`,
  both created from scratch, both expiring 2027-09-13.

**One ordering decision that paid off.** Running the real build _before_ the scratch test meant run 2
found an existing certificate and offered to reuse it:

```
✔ Reuse this distribution certificate?
Cert ID: 9ZQX8XFN35, Serial number: 6B8619E46011CC763186AFE604B81C89 …
    📲 Used by: @fasdev/tapcard … yes
```

Reversing the order would have created a second distribution certificate against Apple's per-account
limit, for a throwaway app. **Certificates are account-wide; provisioning profiles are per bundle
ID.** The scratch app got its own profile (`3Q587DLJXA`) and shared the certificate.

**What this does not prove.** The `.ipa` was never installed and no tag was read from an EAS-built
binary. It is a production (App Store distribution) build, so it cannot be side-loaded. Every NFC
claim in this project still rests on locally-built binaries on iPhone "Fas".

### 5b.7 — Cleanup, done (2026-09-13)

**Apple side removed; Expo side deliberately kept.**

```
com.nfccard.tap  present
deleted bundle id com.nfccard.tap.eastest

VERIFY
  com.nfccard.tap.eastest: gone
  com.nfccard.tap: intact
```

The App ID and its profile `3Q587DLJXA` are gone. The distribution certificate was never touched —
it is shared with the real app, which is why §5b.6 ran the builds in the order it did.

`@fasdev/eas-capability-test` **stays on Expo**, on purpose. Its credentials page is the surviving
record of the experiment: it still shows `com.nfccard.tap.eastest` configured, which documents what
was tested after the Apple-side identifier no longer exists.

There is no `eas` command for deleting an App ID, so this went through `@expo/apple-utils` — the
library bundled inside `eas-cli` — reusing its authentication. Two things that cost time:

1. **`BundleId`'s instance `deleteAsync` requires `{ id }` passed explicitly**, despite being a
   method on an object that already knows its own id. `await bundleId.deleteAsync()` throws
   `Cannot destructure property 'id' of 'undefined'`. It wants
   `await bundleId.deleteAsync({ id: bundleId.id })`.

2. **`getBundleIdCapabilitiesAsync()` reads already-loaded relationships; it does not fetch.**
   `findAsync` does not populate them, so a safety check built on it reported `(none)` for _both_
   identifiers and would have raised a false alarm about the real app losing NFC. The fetching
   accessor is `getOrFetchBundleIdCapabilitiesAsync()`, which gives the real answer:

```
com.nfccard.tap: 2PT643SD6R_IN_APP_PURCHASE, 2PT643SD6R_NFC_TAG_READING
com.nfccard.tap.eastest: NOT PRESENT
```

**`NFC_TAG_READING` survived the cleanup**, verified after the fact rather than assumed — which is
the only reason the wrong reading was caught at all.

One boundary worth recording: Apple's cached session expires within minutes, and the only
non-interactive way past it is reading the Apple ID password out of the macOS Keychain. Every step
here that touched Apple needed a human at the keyboard.
