/**
 * T0 smoke test — proves the runner executes TypeScript and enforces types.
 *
 * Deliberately trivial. Phase 2's real value is that `lib/ndef.ts` imports
 * nothing from react-native, so the decoder is testable with no device at all —
 * the only reason this phase can proceed while the Android phone is
 * unavailable. This test exists to prove the harness works before we depend
 * on it.
 *
 * Note the explicit `@jest/globals` import rather than relying on ambient
 * globals from `@types/jest`. Expo's base tsconfig sets no `types` field, and
 * pinning one here would replace TypeScript's automatic @types discovery
 * wholesale — we would have to enumerate `react` and `node` by hand just to
 * add `jest`. Importing the globals keeps test types inside test files, where
 * they belong, and keeps `describe`/`it`/`expect` out of the app's namespace.
 */
import { describe, expect, it } from '@jest/globals';

describe('test harness', () => {
  it('runs TypeScript', () => {
    const bytes: number[] = [0x04, 0x65];
    expect(bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')).toBe('04 65');
  });
});
