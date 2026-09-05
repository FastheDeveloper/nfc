import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { AntennaHint } from '../../components/AntennaHint';
import { Button } from '../../components/Button';
import { Container } from '../../components/Container';
import { DeviceBanner } from '../../components/DeviceBanner';
import { ErrorCard } from '../../components/ErrorCard';
import { confirmRead } from '../../lib/feedback';
import { cancelScan, checkNfcStatus, readTagOnce, type NfcStatus } from '../../lib/nfc';
import { summarise } from '../../lib/ndef';
import { isCancellation, toScanError, type ScanError } from '../../lib/scanError';
import { useTagStore, type ScanRecord } from '../../store/tag';

/**
 * A scan that succeeds but yields no tag object.
 *
 * Not an error the library defines — it is the `| null` in `readTagOnce`'s own
 * return type. We have never seen it on hardware and cannot rule it out, so it
 * gets honest copy rather than an optimistic non-null assertion.
 */
const NO_TAG_DATA: ScanError = {
  kind: 'unknown',
  title: 'No tag data',
  detail: 'The scan finished but the tag returned nothing readable. Try again.',
  developer: 'readTagOnce() resolved with null',
  provisional: true,
};

export default function ReadScreen() {
  const router = useRouter();

  const [status, setStatus] = useState<NfcStatus>({ kind: 'checking' });
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<ScanError | null>(null);

  const tag = useTagStore((s) => s.tag);
  const views = useTagStore((s) => s.views);
  const setTag = useTagStore((s) => s.setTag);
  const history = useTagStore((s) => s.history);

  useEffect(() => {
    checkNfcStatus().then(setStatus);
  }, []);

  async function handleScan() {
    setError(null);
    setTag(null);
    setScanning(true);

    try {
      const result = await readTagOnce();

      if (!result) {
        setError(NO_TAG_DATA);
        return;
      }

      setTag(result);

      // Android draws no system UI and gives no feedback of its own, so a
      // successful read is otherwise silent. No-ops on iOS. See lib/feedback.ts.
      void confirmRead();
    } catch (e) {
      // A cancellation is not a failure, so nothing is rendered for it. Phase 1
      // would have painted a red card at someone who simply changed their mind,
      // and only avoided it by accident because the message was empty
      // (DEVLOG §1.13).
      if (isCancellation(e)) return;

      setError(toScanError(e));
    } finally {
      // Runs even on the early return above, so the spinner always clears.
      setScanning(false);
    }
  }

  async function handleCancel() {
    await cancelScan();
    setScanning(false);
  }

  return (
    <Container>
      <ScrollView contentContainerClassName="p-5 gap-5">
        <View className="gap-1">
          <Text className={styles.title}>Read a tag</Text>
          <Text className={styles.subtitle}>
            Hold a tag against the phone to see what it holds.
          </Text>
        </View>

        <DeviceBanner />
        <NfcStatusCard status={status} />

        {status.kind === 'ready' && !scanning && <Button title="Scan a tag" onPress={handleScan} />}

        {scanning && (
          <View className={styles.scanCard}>
            <ActivityIndicator />
            <Text className={styles.scanText}>
              {Platform.OS === 'android'
                ? 'Hold a tag against the back of the phone.'
                : 'Waiting for the system NFC sheet…'}
            </Text>
            <AntennaHint />
            {/* Android draws no system UI, so the app must offer its own way out. */}
            {Platform.OS === 'android' && <Button title="Cancel" onPress={handleCancel} />}
          </View>
        )}

        {error && <ErrorCard error={error} />}

        {tag && !scanning && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityHint="Opens the full tag details"
            onPress={() => router.push('/tag')}
            className={styles.summaryCard}>
            <View className="flex-1 gap-1">
              <Text className={styles.summaryLabel}>Last tag</Text>
              <Text className={styles.summaryValue} numberOfLines={2}>
                {summarise(views)}
              </Text>
              <Text className={styles.summaryMeta}>
                {views.length} record{views.length === 1 ? '' : 's'} · tap for details
              </Text>
            </View>
            <Text className={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}

        {history.length > 1 && !scanning && <RecentScans history={history} />}
      </ScrollView>
    </Container>
  );
}

/**
 * Recent scans (N4) — in-memory only, newest first.
 *
 * Hidden until there is more than one, because a list of exactly the tag
 * already shown above it is noise.
 */
function RecentScans({ history }: { history: ScanRecord[] }) {
  return (
    <View className="gap-2">
      <Text className={styles.sectionLabel}>Recent</Text>
      <View className={styles.historyCard}>
        {history.map((entry) => (
          <View key={`${entry.id ?? 'no-id'}-${entry.at}`} className={styles.historyRow}>
            <Text className={styles.historySummary} numberOfLines={1}>
              {entry.summary}
            </Text>
            <Text className={styles.historyTime}>
              {new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function NfcStatusCard({ status }: { status: NfcStatus }) {
  if (status.kind === 'checking') {
    return <Text className={styles.subtitle}>Checking NFC support…</Text>;
  }

  if (status.kind === 'ready') {
    return (
      <View className={styles.okCard}>
        <Text className={styles.okText}>NFC ready</Text>
      </View>
    );
  }

  return (
    <View className={styles.warnCard}>
      <Text className={styles.warnTitle}>
        {status.kind === 'disabled' ? 'NFC is switched off' : 'NFC unavailable'}
      </Text>
      <Text className={styles.warnText}>
        {status.kind === 'disabled'
          ? 'Turn NFC on in Android system settings. A deep link to that screen arrives in Phase 4.'
          : status.reason}
      </Text>
    </View>
  );
}

const styles = {
  title: 'text-3xl font-bold text-neutral-900 dark:text-neutral-50',
  subtitle: 'text-base text-neutral-500 dark:text-neutral-400',
  okCard:
    'rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-3',
  okText: 'text-sm font-medium text-emerald-800 dark:text-emerald-300',
  warnCard:
    'rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-4 gap-1',
  warnTitle: 'text-sm font-semibold text-amber-900 dark:text-amber-300',
  warnText: 'text-sm text-amber-800 dark:text-amber-400',
  scanCard:
    'rounded-2xl border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950 p-5 gap-4 items-center',
  scanText: 'text-sm text-indigo-900 dark:text-indigo-300 text-center',
  summaryCard:
    'flex-row items-center gap-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-4',
  summaryLabel:
    'text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500',
  summaryValue: 'text-base font-medium text-neutral-900 dark:text-neutral-100',
  summaryMeta: 'text-xs text-neutral-500 dark:text-neutral-400',
  chevron: 'text-2xl text-neutral-300 dark:text-neutral-600',
  sectionLabel:
    'text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500',
  historyCard:
    'rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-4 py-2',
  historyRow: 'flex-row items-center justify-between gap-4 py-2',
  historySummary: 'text-sm text-neutral-700 dark:text-neutral-300 flex-1',
  historyTime: 'text-xs text-neutral-400 dark:text-neutral-500',
};
