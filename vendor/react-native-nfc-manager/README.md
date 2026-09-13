# Vendored `ndef-lib` — kept as evidence, not as a dependency

This is a verbatim copy of `ndef-lib` from **`react-native-nfc-manager@3.17.2`**, MIT licensed
(© Richie Hsieh and Revteltech; the files themselves © 2013 Don Coleman). `LICENSE` is included
alongside.

**Nothing in the app imports it.** It exists only so the tests in `lib/ndef.test.ts` and
`lib/ndefEncode.test.ts` keep working after the package was removed in Phase 4 T10.

## Why keep it at all

Those tests are in two groups, and both would otherwise disappear along with the package:

**Agreement** — our URI decoder and encoder are asserted to match this one byte for byte, across
twelve real URIs and all 36 prefix indices. That is the cheapest proof we have that a lookup table
typed out by hand is correct, and losing it would leave the table unverified.

**Divergence** — four characterisation tests pin defects in *this* code, which are the documented
reason `lib/ndef.ts` exists at all (DEVLOG §2.3):

| Defect | Where |
| ------ | ----- |
| Text decoder computes the language code's length, then discards the code — the extracting line is commented out | `ndef-text.js` |
| UTF-16 flag ignored entirely; an open `TODO` | `ndef-text.js` |
| `String.fromCharCode` truncates above U+FFFF, so U+1F600 decodes to U+F600 | `util.js` |

Delete this directory and those tests become unrunnable, and the argument for having written our
own decoder becomes an assertion in a document rather than something a reader can execute.

## `NfcError.js`

Kept for the same reason, for a different finding. Every one of its 24 error classes is
constructed with no arguments, so `message` is always `''` and the meaning lives only in the class
(DEVLOG §1.13). That is what made a failed scan render as **nothing** in Phase 1, and it is the
single clearest argument in the project for typed native errors that carry a code *and* a message.

`lib/vendorEvidence.test.ts` asserts it.

## Do not "fix" these files

They are frozen deliberately. Their value is that they are wrong in the specific ways the tests
describe. If you want the correct behaviour, it is in `lib/ndef.ts`.

If a future version of the upstream package fixes any of this, the divergence tests will fail —
which is the signal to re-run the comparison against the new version and reconsider whether
hand-rolling still earns its place.
