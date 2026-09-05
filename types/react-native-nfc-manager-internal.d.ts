/**
 * Types for a deep import into `react-native-nfc-manager`.
 *
 * The package ships `index.d.ts` for its public entry point only, so importing
 * `react-native-nfc-manager/src/NfcError` directly is an implicit `any` and
 * `tsc` rejects it under `strict`.
 *
 * We import that path on purpose: the package root instantiates a
 * `NativeEventEmitter` at module load and throws outside a native runtime,
 * which would make `lib/scanError.ts` impossible to unit test. See the header
 * of that file.
 *
 * This declaration mirrors the class hierarchy the package already documents in
 * its own `index.d.ts` under the `NfcError` namespace, so the two cannot drift
 * apart without the package changing shape. The two `build*` functions are not
 * in the public types at all — they are how the library converts a native error
 * string into one of these classes, and the tests use them to prove that iOS's
 * `NFCError:200` and Android's `'cancelled'` converge on the same class.
 */
declare module 'react-native-nfc-manager/src/NfcError' {
  export class NfcErrorBase extends Error {}

  export class UnsupportedFeature extends NfcErrorBase {}
  export class SecurityViolation extends NfcErrorBase {}
  export class InvalidParameter extends NfcErrorBase {}
  export class InvalidParameterLength extends NfcErrorBase {}
  export class ParameterOutOfBound extends NfcErrorBase {}
  export class RadioDisabled extends NfcErrorBase {}

  export class TagConnectionLost extends NfcErrorBase {}
  export class RetryExceeded extends NfcErrorBase {}
  export class TagResponseError extends NfcErrorBase {}
  export class SessionInvalidated extends NfcErrorBase {}
  export class TagNotConnected extends NfcErrorBase {}
  export class PacketTooLong extends NfcErrorBase {}

  export class UserCancel extends NfcErrorBase {}
  export class Timeout extends NfcErrorBase {}
  export class Unexpected extends NfcErrorBase {}
  export class SystemBusy extends NfcErrorBase {}
  export class FirstNdefInvalid extends NfcErrorBase {}

  export class InvalidConfiguration extends NfcErrorBase {}

  export class TagNotWritable extends NfcErrorBase {}
  export class TagUpdateFailure extends NfcErrorBase {}
  export class TagSizeTooSmall extends NfcErrorBase {}
  export class ZeroLengthMessage extends NfcErrorBase {}

  /** Maps a CoreNFC `NFCError:<code>` string onto one of the classes above. */
  export function buildNfcExceptionIOS(error: string): NfcErrorBase;

  /** Maps an Android error string (e.g. `'cancelled'`) onto the same classes. */
  export function buildNfcExceptionAndroid(error: string): NfcErrorBase;
}
