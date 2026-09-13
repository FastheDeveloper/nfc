# PROJECT_FACTS.md

Source material for the freeCodeCamp article. Distilled from [`DEVLOG.md`](./DEVLOG.md) (the
chronological record), [`PLATFORM-NOTES.md`](./PLATFORM-NOTES.md) (the comparison) and
[`GOTCHAS.md`](./GOTCHAS.md) (the traps).

**Every number here was read out of the code or a passing test, not from memory.** Where a claim is
unverified it says so. §9 lists the things most likely to be misremembered when drafting — read it
before writing anything from recollection.

⛔ throughout means **never run on an Android device**. No Android hardware has been available
since Phase 1.

---

## 1. WHAT THIS ACTUALLY IS

**TapCard** — an NFC app for **iOS**, with an Android counterpart that compiles and has never run. Write your contact details to a
physical NFC tag as a URL or a vCard; read any NDEF tag back in human-readable form. No backend;
the profile lives on the device and goes straight onto the chip.

The article is not really about business cards. It is about three things the project kept running
into:

1. **NFC has no simulator path on either platform.** Every claim must come from hardware. That is
   the defining constraint, and it shaped the architecture — all the decoding logic is pure and
   device-free precisely so that _something_ could progress while a phone was unavailable.
2. **The two platforms are asymmetric in ways a cross-platform library has to hide, and hiding them
   is sometimes a lie.** `isEnabled()` is a real toggle on Android and a meaningless question on
   iOS. The honest API says so.
3. **What it takes to stop depending on someone else's native module** — and what you inherit when
   you delete one.

It ends with `react-native-nfc-manager` removed from `package.json` and the app running entirely on
a hand-written Expo Module in Swift and Kotlin.

**The two best beats are both mistakes**, and both are documented rather than tidied away: a wrong
conclusion about iOS's capabilities that survived three documents (§4), and a bug that 272 passing
tests were structurally incapable of catching (§6).

## 2. THE SHARED API SURFACE

One TypeScript boundary, `lib/nfcBackend.ts` (121 lines). No screen talks to the native layer.

```ts
startNfc():        Promise<boolean>
checkNfcStatus():  Promise<NfcStatus>       // checking | ready | disabled | unsupported
readTag():         Promise<ReadResult>      // { tag, capacity }
writeTag(bytes):   Promise<WriteOutcome>    // { status, capacity, written, verified, verifyNote }
cancelScan():      Promise<void>            // Android only, by necessity
```

That indirection is the whole reason swapping the entire native implementation was a **one-line
change** rather than a rewrite. It existed before it was needed, which is the only time such a thing
is cheap.

**The decoding layer is pure TypeScript and platform-agnostic.** `Data` / `ByteArray` do not cross
the bridge, so records arrive as `number[]` from both platforms and one decoder handles both:

| Module              | Lines | Job                                                                 |
| ------------------- | ----- | ------------------------------------------------------------------- |
| `lib/ndef.ts`       | 535   | Decoder: TNF dispatch, URI prefix table, text status byte, UTF-8/16 |
| `lib/ndefEncode.ts` | 140   | Encoder: records → bytes, longest-prefix compression                |
| `lib/vcard.ts`      | 168   | vCard 3.0: escaping, octet-safe folding                             |
| `lib/capacity.ts`   | ~170  | Will it fit — reported vs assumed                                   |
| `lib/scanError.ts`  | 234   | Native exceptions → user-facing copy                                |
| `lib/tagFacts.ts`   | 164   | Tag → rows, with an explicit "not reported" state                   |

**Phase 4 replaced the native bridge and left every line of that untouched.** Worth saying in the
article: the replacement was scoped to the part that actually had to be native.

## 3. iOS PATH

**Session-based.** `NFCTagReaderSession` → delegate → four nested async steps: begin → detect →
connect → `queryNDEFStatus` → `readNDEF`. The OS draws a sheet you cannot restyle.

| File                    | Lines | What                                               |
| ----------------------- | ----- | -------------------------------------------------- |
| `NfcReadSession.swift`  | 187   | The read, and settling one promise from five paths |
| `NfcWriteSession.swift` | 224   | Query → refuse → write → verify, one session       |
| `NfcExceptions.swift`   | 135   | 13 typed exceptions with a code _and_ a message    |
| `NfcTagInfo.swift`      | 110   | Tag → bridge conversions                           |
| `NfcNativeModule.swift` | 121   | The Expo module definition                         |

**Three things CoreNFC demands and does not tell you:**

- The session must be **retained by the module**, not the function. A local is deallocated on return
  and the sheet vanishes with no error.
- A **successful** read also invalidates the session, so `didInvalidateWithError` fires afterwards
  and will overwrite your result unless settling is guarded.
- **Entitlements are gated per polling option.** `.iso18092` needs its own, and asking without it
  fails the _entire_ session.

**What iOS front-loads:** an App ID registered in a web portal, a capability ticked on it, a paid
membership, a certificate, a provisioning profile — all before reading a single byte. Get it wrong
and the failure is a **code-signing error that never says "NFC"**.

## 4. ANDROID PATH ⛔ — the bonus appendix, not a promise

The article is framed as an **iOS handbook**. Android appears once, at the end, clearly labelled as
written-but-never-executed. Do not draft anything that implies parity, and do not show Android
output — there isn't any.

**Reader mode, not a session.** `NfcAdapter.enableReaderMode(activity, callback, flags, extras)` —
a callback bound to the foreground **Activity**, firing on every tag, with no UI and no natural end.

| File                  | Lines | What                                                 |
| --------------------- | ----- | ---------------------------------------------------- |
| `NfcReaderSession.kt` | 192   | One operation, read or write                         |
| `NfcNativeModule.kt`  | 162   | Module definition, capabilities, 12 typed exceptions |
| `NfcTagInfo.kt`       | 60    | Tag → bridge, same shapes as the Swift               |

**Everything iOS handles for you becomes yours:**

|                 | iOS                                 | Android                                    |
| --------------- | ----------------------------------- | ------------------------------------------ |
| Scanning UI     | The OS draws a sheet                | **The app draws everything**               |
| Session end     | Automatic after one tag             | **`disableReaderMode` on every exit path** |
| Needs           | Nothing on screen                   | **The foreground Activity**                |
| Callback thread | Main                                | **A binder thread**                        |
| Cancelling      | The system sheet                    | **Build it yourself**                      |
| Permission      | Entitlement + portal + paid account | One manifest line, free                    |

**Status:** compiles clean (`BUILD SUCCESSFUL`, zero Kotlin errors, zero warnings in our module),
`android.permission.NFC` confirmed in the merged manifest, **and not one line has ever run.**

## 5. THE REPLACEMENT ARC

The narrative spine, and the reason it is more interesting than "we wrote a module":

**Phase 1–3** build on `react-native-nfc-manager`. **Phase 4** replaces it. The original
justification — _iOS cannot report tag capacity_ — **turned out to be false** (§4 below), so the
phase was re-decided rather than quietly continued:

> in case someone prefers to build their own package, or the company is huge on doing things
> internally

The evidence that justifies it was gathered by **reading the dependency**, not by hitting bugs in
production:

| Finding                                                                                                         | File                      |
| --------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Text decoder measures the language code's length, then discards the code (the extracting line is commented out) | `ndef-lib/ndef-text.js`   |
| UTF-16 flag ignored entirely — an open `TODO`                                                                   | `ndef-lib/ndef-text.js`   |
| `String.fromCharCode` truncates above U+FFFF: U+1F600 → U+F600                                                  | `ndef-lib/util.js`        |
| `index.d.ts` is invalid TypeScript (`TS1246`), compiles only because `skipLibCheck` is on                       | `index.d.ts`              |
| Package root throws outside a native runtime (builds a `NativeEventEmitter` at load)                            | `src/NativeNfcManager.js` |
| All 24 error classes constructed with no arguments, so `message` is always `''`                                 | `src/NfcError.js`         |

**The switch was made on measurement, not preference.** Both implementations read the same physical
chip and were diffed field by field: **4 identical, 2 reported only by ours, 0 conflicts.**

**The evidence was kept after the dependency was deleted** — `vendor/react-native-nfc-manager/`
holds a frozen copy with its MIT licence, imported by nothing but `lib/vendorEvidence.test.ts`, and
excluded from ESLint and Prettier because its value is being wrong in documented ways.

## 6. WHAT'S GENUINELY HARD HERE

### The inference that was wrong for three documents

Phases 1–2 concluded **iOS cannot report tag capacity**, said so in DEVLOG, PLATFORM-NOTES and the
UI, and built Phase 4's motivation on it.

- **What was observed** (true): `getTag()` on iOS returns `{ id, tech }` — no `maxSize`.
- **What was concluded** (false): the platform cannot answer the question.

`ndefHandler.getNdefStatus()` → CoreNFC's `queryNDEFStatus` returns both a read/write status and a
real capacity, **inside the session `requestTechnology` already opens.** The capability was one call
away from code that had been running since Phase 1.

The generalisable point, and the best line in the project:

> The rule was "nothing is written down as fact until observed on a device". That rule was applied
> to the observation and abandoned for the inference built on top of it. **An unverified conclusion
> is exactly as dangerous as an unverified measurement, and harder to notice, because it arrives
> wearing the credibility of the real data underneath it.**

A contributing bug made it harder to find: the write pre-flight threw the _library's_ own
`TagSizeTooSmall`, making our refusal indistinguishable from CoreNFC's and erasing the one signal
that would have revealed a capacity had been reported. **Never throw a dependency's error type from
your own logic.**

### The bug 272 tests could not catch

After switching to the native module, cancelling a scan rendered a red _"Could not read the tag"_
card instead of nothing.

Our Swift throws `UserCancelledException`. The mapping table was keyed on `UserCancelledException`.
They do not match, because **Expo derives the code**: strip the trailing `Exception`, split
camelCase, upper-case, prefix `ERR_` → `ERR_USER_CANCELLED`
(`expo-modules-core/ios/Core/Exceptions/CodedError.swift:45`).

Why every test passed:

```ts
const wrapped = (code, message) =>
  new Error(`Calling the 'readTag' function has failed → Caused by: ${code}: ${message}`);
```

No `code` property — because we did not know Expo set one. **The code and its tests shared a single
wrong assumption and agreed with each other perfectly.**

> A fixture you invented can only prove your code is self-consistent. It took a thumb on a Cancel
> button.

### Three escaping mistakes in ten minutes

`'\;'` in a JavaScript string literal is `';'` — an unknown escape silently drops the backslash, so
the vCard escaper escaped nothing. Then the _test_ asserted the unescaped result and failed against
correct code. Then a third test used `not.toContain('N:')`, which can never pass because
`BEGIN:VCARD` contains `N:`.

> Test-first would not have helped: the test and the code shared the misunderstanding. String
> escaping is a domain where they usually do.

### Silent failures dominate this whole domain

A dozen of the 60 traps in `GOTCHAS.md` produce **no error at all**: the deallocated session, the
removed config plugin, the unescaped semicolon, the truncated emoji, the gitignored native module,
the empty error message. The article's strongest practical advice may simply be: _in NFC work,
assume the failure will be silent and design your checks accordingly._

## 7. NUMBERS AND SPECIFICS

All read from code or passing tests on 2026-09-13.

**The tag** — a real NTAG213, iPhone 13 Pro, iOS 26.5:

|                        |                                                                        |
| ---------------------- | ---------------------------------------------------------------------- |
| UID                    | `04C4FC91DF2A81` (7 bytes; `04` = NXP)                                 |
| iOS `getTag()` returns | `{ "id": "04C4FC91DF2A81", "tech": "mifare" }` — two keys              |
| Reported capacity      | **137 bytes** (max NDEF _message_)                                     |
| Chip user memory       | 144 bytes (36 pages × 4, pages 4–39) — **not the number that matters** |
| NDEF status            | `2` = read-write                                                       |

**Payload sizes** (pinned by tests, so the article cannot drift from the app):

| Payload                                   | Encoded message                               |
| ----------------------------------------- | --------------------------------------------- |
| `https://example.com/fas` as a URI record | **20 bytes**                                  |
| Realistic vCard, as text                  | **200 bytes**                                 |
| The same vCard as an NDEF message         | **213 bytes**                                 |
| TLV framing the tag adds                  | 3 bytes (5 once ≥255)                         |
| **Verdict on a 137-byte tag**             | URL fits with 117 spare; vCard is **76 over** |

**The project:**

|                       |                                                     |
| --------------------- | --------------------------------------------------- |
| Tests                 | **243**, 12 suites, ~1s, no device needed           |
| Hand-written native   | ~777 lines Swift, ~414 lines Kotlin                 |
| Pure TypeScript logic | ~1,450 lines across 8 modules                       |
| Runtime dependencies  | 28 (NFC: **zero**)                                  |
| Full iOS rebuild      | ~1.5 GB DerivedData                                 |
| First Android build   | 13m 40s, cold cache                                 |
| `expo-doctor`         | 20/21 (the one failure is upstream SDK patch drift) |

**Stack:** Expo SDK 57.0.20 · React Native 0.86.3 · React 19.2.3 · expo-router · NativeWind ·
Zustand + AsyncStorage · pnpm · **no third-party NFC dependency**.

**URI prefix table:** 36 entries. `https://` is index `0x04` — one byte instead of eight.

## 8. QUOTABLE LINES

- "An unverified conclusion is exactly as dangerous as an unverified measurement, and harder to
  notice, because it arrives wearing the credibility of the real data underneath it."
- "A fixture you invented can only prove your code is self-consistent."
- "One API's silence is not a platform limitation."
- "Never throw a dependency's error type from your own logic. It collapses 'we refused' and 'they
  refused' into one signal, and you will want to tell them apart precisely when something is going
  wrong."
- "Owning the native side does not exempt you from error plumbing; it changes which layer surprises
  you."
- "Ask only for what you can sign for."
- "Removing a dependency means inheriting its build configuration. The code it exports is the
  visible half."
- "A tag fact is not just a value or zero — it can be _this platform does not tell us_, and that is
  a different thing."
- "Android volunteers this information with an ordinary read; iOS makes you ask a specific question
  inside a session. Same data, different price of admission."
- "A comment saying 'the library is buggy' rots in silence; a test saying so cannot."
- "The scaffolding is no longer the hard part."
- "There is no simulator path. No amount of unit testing, mocking or CI substitutes for holding a
  chip against a phone."
- "iOS front-loads the pain and Android back-loads it."
- On the vCard trade: "A URL is tiny and universally handled — and completely dependent on something
  answering at the other end. A vCard is the whole card, and does not fit."
- On what the replacement bought: "Not speed, and not fewer lines. The next decoder bug is an
  afternoon's work instead of an issue on someone else's tracker."

## 9. CODE ↔ ARTICLE DISCREPANCIES

**Read this before drafting from memory.** Two claims were corrected mid-project, and the earlier
versions are still present in the repo under "superseded" banners — deliberately, because how the
mistake was made is the teaching material. Quoting them as current would be wrong.

| Do not write                                            | Write instead                                                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| "iOS cannot report tag capacity"                        | iOS reports it via `getNdefStatus()` / `queryNDEFStatus`, inside the session. Only `getTag()` omits it.                |
| "An NTAG213 holds 144 bytes"                            | 144 is _user memory_. The max NDEF **message** is **137**, and that is what a writer needs.                            |
| "Phase 4 exists because iOS can't read capacity"        | Phase 4 exists to own the native layer, for teams that cannot take a third-party dependency.                           |
| "Expo uses your exception class name as the error code" | It derives `ERR_USER_CANCELLED` from `UserCancelledException`.                                                         |
| "The scan sheet shows `NFCReaderUsageDescription`"      | It shows the per-call `alertMessage`. The usage description is never user-facing.                                      |
| "`isEnabled()` is false when NFC is off"                | True on Android. On iOS there is no toggle, so the question is meaningless and the honest answer restates "supported". |

**Also easy to get wrong:**

- The capacity model **does not** add TLV framing to the message before comparing. It did once; that
  was double-counting. The framing is displayed, never counted.
- `lib/writeError.ts` and the JS pre-flight **no longer exist** — the pre-flight moved into Swift,
  and the file became unreachable.
- The parity harness and the capabilities card were **deliberately deleted** in T10. They existed to
  compare against a dependency that is gone.
- **Every Android claim is unverified.** The Kotlin compiles and mirrors the Swift; nothing has run.
  If the article shows Android screenshots or output, they do not exist yet.

## 10. WHAT IS NOT DONE

- **Android on hardware.** Read, write, cancel, `NfcDisabledException`, `techTypes`, and every ⏳ in
  PLATFORM-NOTES.
- **Formatting an unformatted tag.** Android has `NdefFormatable`; iOS exposes no formatting API at
  all — `writeNDEF` simply fails on a non-NDEF tag. Needs a genuinely unformatted chip.
- **Phase 5** — read-only locking (**permanent**; needs a chip named as sacrificial first), an EAS
  build comparison, and article prep.
- **Background tag reading** — Android's `NDEF_DISCOVERED` intent filter versus iOS's OS-mediated
  notification. The four-way matrix in PLATFORM-NOTES §4 is still entirely ⏳.
