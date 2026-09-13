# Phase 5 — Locking a tag, permanently

Working state, not article material.

**Status:** ✅ **T0–T4 verified on hardware · EAS comparison **verified on a real build**** · T5 commit handed over · Kotlin ⛔ never run.

---

## ⚠️ This phase cannot be undone

Every earlier phase was reversible. A write replaces a tag's contents; you can always write
something else. **Locking is different: it is a one-way hardware change.** The chip's lock bits are
burned, and no software — ours, Apple's, or anyone's — can restore them. A locked tag can be read
forever and never written again.

So the rules for this phase:

- **A specific chip must be nominated as sacrificial before anyone taps anything.** Not "one of the
  spares" — a physical chip, identified, that you have decided to spend.
- **The confirmation must be proportionate to the consequence.** Two taps is what we use for a
  write, which is reversible. This needs more.
- **Never lock a tag that holds something you have not already written elsewhere.**
- The app must show what is currently on the tag _before_ asking, so nobody locks the wrong chip.

## Why build it at all

Because it is what real deployments do. An event badge, a product-authentication seal, a museum
label — anything handed to the public — gets locked so it cannot be overwritten by the next person
with a phone. A tag you can rewrite is a tag anyone can rewrite.

It is also the honest end of the article: the one operation where getting the UX wrong destroys
something physical.

---

## Tasks

### T0 — The native lock ✅

- [x] Swift: `NfcLockSession` — query status → confirm writable → `writeLock` → verify it took
- [x] Typed exceptions: already locked, not lockable, lock failed
- [x] ⛔ Kotlin: `Ndef.makeReadOnly()`, same shape
- **Test:** ⏳ needs a nominated chip

### T1 — The rules, pure ✅ (11 tests)

- [x] `lib/lock.ts` — confirmation gate, verification of the resulting status
- [x] Typing the tag's own UID is what unlocks the button (the GitHub-delete pattern)
- **Test:** `pnpm test`

### T2 — The screen ✅

- [x] Read the tag first and show what is on it
- [x] Type the UID to arm; a single button press is never enough
- [x] Plain language: permanent, cannot be undone, the tag can never be written again
- **Test:** ⏳ on the nominated chip

### T3 — Verify the lock took ✅ **confirmed on a sacrificial chip**

- [x] Re-read after locking: NDEF status must report read-only
- [x] Attempting a write afterwards must fail with our `read-only` kind
- **Test:** ⏳ the same chip, twice

### T4 — Documentation ✅

- [x] DEVLOG §5, PLATFORM-NOTES, GOTCHAS, the handbook's closing chapter
- [x] README — tick Phase 5

### T5 — Commit

- [ ] Message handed over

---

## Deferred

**EAS build comparison** — ✅ **written 2026-09-13** as DEVLOG §5b and a handbook chapter, from
Expo's documentation rather than from a build we ran. The project remains deliberately unlinked
(no `extra.eas.projectId`), because `eas build:configure` creates a cloud project as a side effect.

The headline finding: **EAS auto-enables `com.apple.developer.nfc.readersession.formats` on the App
ID from the entitlements file** — the exact manual step that cost an afternoon in §1.9. And the
trap: it will also _disable_ a capability that is enabled remotely but missing locally.

- [x] **Linked, on the user's explicit approval (2026-09-13).** `@fasdev/tapcard`, project
      `6c1efc31-c3a8-4349-b62d-12395719ee55`. `app.json` pins `owner: "fasdev"` and now declares
      `ITSAppUsesNonExemptEncryption: false`.
- [x] **Read `eas-cli@22.0.0`'s source** rather than trusting the docs — DEVLOG §5b.4. The NFC
      entry is in `capabilityList.js` verbatim, the sync is two-way by construction, and it runs
      from the **credentials** step, so `eas credentials:configure-build` syncs capabilities without
      spending a build.
- [x] **Scratch project built for the decisive test** — `com.nfccard.tap.eastest`, a bundle ID that
      has never existed, isolated from TapCard's credentials.
- [x] ✅ **Both interactive runs done — §5b is observed** (DEVLOG §5b.6). Real app:
      `Synced capabilities: No updates`, as predicted, because §1.9 had already done it by hand.
      Fresh bundle ID `com.nfccard.tap.eastest`: **`Synced capabilities: Enabled: NFC Tag Reading`**
      — the claim, proven, at zero build cost.
- [x] **Production build succeeded first attempt** — `fa88d8cb`, `.ipa` published. Never installed:
      App Store distribution cannot be side-loaded, so no NFC claim rests on it.
- [ ] **Cleanup owed** (DEVLOG §5b.7): delete `@fasdev/eas-capability-test` and App ID
      `com.nfccard.tap.eastest`. Do **not** revoke the distribution certificate — it is the real
      app's.
