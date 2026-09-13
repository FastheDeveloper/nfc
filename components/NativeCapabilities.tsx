import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { describeNativeError } from '../lib/nativeError';
import { summarise } from '../lib/ndef';
import { decodeMessage } from '../lib/ndef';
import { isNativeCancellation, readTagNative } from '../lib/nfcNative';
import { openNfcSettings, readCapabilities, type NfcCapabilities } from '../lib/nfcCapabilities';
import { Collapsible } from './Collapsible';
import { Mono } from './Mono';

/**
 * Our own native module, reporting for duty.
 *
 * Shown next to the library-driven status card on purpose: while Phase 4 is in
 * progress both implementations answer the same questions, and any disagreement
 * between them is a finding rather than a nuisance. The card comes out with the
 * dependency in T10.
 */
export const NativeCapabilities = () => {
  const [error, setError] = useState<{ code: string; message: string; chain: string[] } | null>(
    null
  );
  const [settingsResult, setSettingsResult] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [readResult, setReadResult] = useState<string[] | null>(null);

  let capabilities: NfcCapabilities | null = null;
  try {
    capabilities = readCapabilities();
  } catch (e) {
    // The most likely cause by far: JS reloaded but the binary predates the
    // module. Native code does not hot-reload — it needs `expo run:ios`.
    if (!error) capabilities = null;
    void e;
  }

  if (!capabilities) {
    return (
      <View className={styles.card}>
        <Text className={styles.label}>Our native module</Text>
        <Text className={styles.warn}>
          Not in this build. Native code does not hot-reload — rebuild with `expo run:ios`.
        </Text>
      </View>
    );
  }

  return (
    <View className={styles.card}>
      <Text className={styles.label}>Our native module</Text>

      <Row label="isSupported()" value={String(capabilities.supported)} />
      <Row label="isEnabled()" value={String(capabilities.enabled)} />
      <Row label="canOpenSettings()" value={String(capabilities.canOpenSettings)} />

      <Text className={styles.note}>
        {capabilities.enabledIsMeaningful
          ? 'On Android “enabled” is a real toggle the user can change while the app runs.'
          : 'On iOS there is no NFC toggle, so “enabled” only restates “supported”.'}
      </Text>

      <TouchableOpacity
        accessibilityRole="button"
        onPress={async () => {
          setError(null);
          setSettingsResult(null);
          try {
            await openNfcSettings();
            setSettingsResult('Settings opened.');
          } catch (e) {
            // Expo wraps a native exception, so `e.message` is the framework
            // describing its own plumbing. Our sentence is at the end of the
            // cause chain — see lib/nativeError.ts.
            setError(describeNativeError(e));
          }
        }}
        className={styles.button}>
        <Text className={styles.buttonText}>Call openNfcSettings()</Text>
      </TouchableOpacity>

      <TouchableOpacity
        accessibilityRole="button"
        disabled={reading}
        onPress={async () => {
          setError(null);
          setReadResult(null);
          setReading(true);
          try {
            const { tag, capacity, status } = await readTagNative();
            // Decoded with the same lib/ndef.ts the library path uses — the
            // parser is untouched by this phase, only the bridge changed.
            const views = decodeMessage(tag.ndefMessage);
            setReadResult([
              `id: ${tag.id}`,
              `tech: ${tag.tech}`,
              `status: ${status} (${status === 2 ? 'read-write' : status === 3 ? 'read-only' : 'not NDEF'})`,
              `capacity: ${capacity ?? 'none'} bytes`,
              `records: ${views.length}`,
              `decoded: ${summarise(views)}`,
            ]);
          } catch (e) {
            if (isNativeCancellation(e)) return;
            setError(describeNativeError(e));
          } finally {
            setReading(false);
          }
        }}
        className={`${styles.button} ${reading ? 'opacity-40' : ''}`}>
        <Text className={styles.buttonText}>
          {reading ? 'Waiting for the sheet…' : 'Read a tag with our module'}
        </Text>
      </TouchableOpacity>

      {readResult && (
        <View className="gap-1">
          {readResult.map((line) => (
            <Mono key={line} className={styles.mono}>
              {line}
            </Mono>
          ))}
        </View>
      )}

      {settingsResult && <Mono className={styles.mono}>{settingsResult}</Mono>}

      {error && (
        <View className="gap-1">
          <Text className={styles.note}>{error.message}</Text>
          <Collapsible title="Raw error chain">
            <Mono className={styles.mono}>code: {error.code}</Mono>
            {error.chain.map((link, i) => (
              <Mono key={i} className={styles.mono}>
                {i === 0 ? '' : '↳ '}
                {link}
              </Mono>
            ))}
          </Collapsible>
        </View>
      )}
    </View>
  );
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className={styles.row}>
      <Mono className={styles.mono}>{label}</Mono>
      <Mono className={styles.monoValue}>{value}</Mono>
    </View>
  );
}

const styles = {
  card: 'rounded-2xl border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950 p-4 gap-2',
  label: 'text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400',
  row: 'flex-row items-center justify-between gap-4',
  mono: 'text-xs text-violet-900 dark:text-violet-300',
  monoValue: 'text-xs font-semibold text-violet-900 dark:text-violet-200',
  note: 'text-xs text-violet-800/80 dark:text-violet-400/80',
  warn: 'text-xs text-violet-800 dark:text-violet-400',
  button: 'rounded-xl border border-violet-400 dark:border-violet-700 px-3 py-2 items-center mt-1',
  buttonText: 'text-xs font-medium text-violet-800 dark:text-violet-300',
};
