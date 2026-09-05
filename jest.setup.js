/**
 * Jest setup.
 *
 * AsyncStorage is a native module, so importing it outside a device throws
 * "NativeModule: AsyncStorage is null". The package ships an in-memory mock for
 * exactly this; wiring it here keeps `store/profile.ts` free of test-only
 * branches.
 *
 * Same shape of problem as `react-native-nfc-manager` in `lib/scanError.ts`,
 * solved differently: NFC's error classes could be imported from a module that
 * never touches the native side, whereas AsyncStorage *is* the native side and
 * has to be replaced.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
