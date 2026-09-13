import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { Container } from '../../components/Container';
import { ErrorCard } from '../../components/ErrorCard';
import { Mono } from '../../components/Mono';
import {
  assessCapacity,
  capacityCaveat,
  capacityDetail,
  capacityTitle,
  type Capacity,
} from '../../lib/capacity';
import { compressUri, mimeRecord, uriRecord } from '../../lib/ndefEncode';
import { URI_PREFIXES } from '../../lib/ndef';
import { encodeMessage } from '../../lib/ndefEncode';
import { writeTag, type WriteOutcome } from '../../lib/nfcBackend';
import { isCancellation, toScanError, type ScanError } from '../../lib/scanError';
import { toVCard } from '../../lib/vcard';
import { isProfileEmpty, useProfileStore } from '../../store/profile';
import { useTagStore } from '../../store/tag';

type PayloadKind = 'url' | 'vcard';

/**
 * Choosing what to put on the tag.
 *
 * The two options are not variations on a theme — they are opposite trades,
 * and the numbers make the argument better than any copy could:
 *
 *   URL    ~23 bytes.  Universally handled, opens with no app installed,
 *          and completely dependent on something answering at the other end.
 *   vCard  ~216 bytes. Entirely self-contained, works with no network at all,
 *          and does not fit on the tags this project bought.
 *
 * So the screen shows both sizes against the budget and lets the user decide,
 * rather than quietly picking one.
 */
export default function WriteScreen() {
  const router = useRouter();

  const profile = useProfileStore((s) => s.profile);
  const hasHydrated = useProfileStore((s) => s.hasHydrated);

  const [kind, setKind] = useState<PayloadKind>('vcard');
  const [confirming, setConfirming] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<ScanError | null>(null);
  const [outcome, setOutcome] = useState<WriteOutcome | null>(null);

  // Once a tag has told us its real size, stop guessing.
  const reportedCapacity = useTagStore((s) => s.reportedCapacity);
  const setReportedCapacity = useTagStore((s) => s.setReportedCapacity);

  if (!hasHydrated) {
    return (
      <Container>
        <View className={styles.centre}>
          <Text className={styles.muted}>Loading your card…</Text>
        </View>
      </Container>
    );
  }

  if (isProfileEmpty(profile)) {
    return (
      <Container>
        <View className={styles.centre}>
          <Text className={styles.emptyTitle}>Nothing to write yet</Text>
          <Text className={styles.emptyBody}>
            Fill in your card on the Profile tab and it will show up here.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => router.push('/profile')}
            className={styles.linkButton}>
            <Text className={styles.linkButtonText}>Go to Profile</Text>
          </TouchableOpacity>
        </View>
      </Container>
    );
  }

  const vcard = toVCard(profile);
  const url = profile.url.trim();

  const records = kind === 'url' ? [uriRecord(url)] : [mimeRecord('text/vcard', vcard)];
  const capacity = assessCapacity(records, reportedCapacity ?? undefined);

  // Both sizes, always — the point of the toggle is the comparison.
  const urlCapacity = url ? assessCapacity([uriRecord(url)], reportedCapacity ?? undefined) : null;
  const vcardCapacity = assessCapacity(
    [mimeRecord('text/vcard', vcard)],
    reportedCapacity ?? undefined
  );

  const missingUrl = kind === 'url' && !url;

  async function handleWrite() {
    setError(null);
    setOutcome(null);
    setConfirming(false);
    setWriting(true);

    try {
      const result = await writeTag(encodeMessage(records));
      setOutcome(result);
      setReportedCapacity(result.capacity);
    } catch (e) {
      // Backing out of the system sheet is not a failure, here as on Read.
      if (isCancellation(e)) return;

      setError(toScanError(e));
    } finally {
      setWriting(false);
    }
  }

  return (
    <Container>
      <ScrollView contentContainerClassName="p-5 gap-5">
        <View className="gap-1">
          <Text className={styles.title}>Write to a tag</Text>
          <Text className={styles.subtitle}>
            Writing replaces whatever the tag holds. It does not lock it.
          </Text>
        </View>

        <View className={styles.segment}>
          <Segment
            label="URL"
            sub={urlCapacity ? `${urlCapacity.requiredBytes} bytes` : 'no link set'}
            active={kind === 'url'}
            onPress={() => setKind('url')}
          />
          <Segment
            label="vCard"
            sub={`${vcardCapacity.requiredBytes} bytes`}
            active={kind === 'vcard'}
            onPress={() => setKind('vcard')}
          />
        </View>

        {missingUrl ? (
          <View className={styles.warnCard}>
            <Text className={styles.warnTitle}>No link on your card</Text>
            <Text className={styles.warnText}>
              Add a link on the Profile tab, or write the vCard instead.
            </Text>
          </View>
        ) : (
          <>
            <CapacityCard capacity={capacity} />
            <Preview kind={kind} url={url} vcard={vcard} capacity={capacity} />
          </>
        )}

        {error && <ErrorCard error={error} />}
        {outcome && <Outcome outcome={outcome} />}

        {writing ? (
          <View className={styles.scanCard}>
            <ActivityIndicator />
            <Text className={styles.scanText}>Hold the tag against the phone…</Text>
          </View>
        ) : (
          <View className="gap-2">
            {/* Two taps. A write replaces whatever the tag holds, and the
                second tap is the one that means it. */}
            <TouchableOpacity
              accessibilityRole="button"
              disabled={missingUrl}
              onPress={() => (confirming ? handleWrite() : setConfirming(true))}
              className={`${confirming ? styles.confirmButton : styles.writeButton} ${
                missingUrl ? 'opacity-40' : ''
              }`}>
              <Text className={styles.writeButtonText}>
                {confirming ? 'Tap again to write' : 'Write to tag'}
              </Text>
            </TouchableOpacity>

            {confirming && (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => setConfirming(false)}
                className={styles.cancelButton}>
                <Text className={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            )}

            <Text className={styles.pending}>
              {capacity.verdict === 'too-big'
                ? 'This will very likely fail — the tag is asked first, and refuses before anything is written.'
                : 'Replaces the tag’s contents. Does not lock it.'}
            </Text>
          </View>
        )}
      </ScrollView>
    </Container>
  );
}

/**
 * What the write session actually learned.
 *
 * `capacity` here is the number the *tag* reported, not our assumption — the
 * first real measurement this project has had on iOS. It is shown plainly so
 * the assumed figure elsewhere can be checked against it.
 */
function Outcome({ outcome }: { outcome: WriteOutcome }) {
  const good = outcome.verified;

  return (
    <View className={good ? styles.okCard : styles.warnCard}>
      <Text className={good ? styles.okTitle : styles.warnTitle}>
        {good ? 'Written and verified' : 'Written, but not confirmed'}
      </Text>
      <Text className={good ? styles.okText : styles.warnText}>
        {outcome.written} bytes written.{' '}
        {good
          ? 'The tag read back exactly what was sent.'
          : (outcome.verifyNote ?? 'The read-back check did not match.')}
      </Text>

      <View className="gap-1 pt-2">
        <Mono className={styles.mono}>
          reported capacity:{' '}
          {outcome.capacity != null ? `${outcome.capacity} bytes` : 'not reported'}
        </Mono>
        <Mono className={styles.mono}>ndef status: {outcome.status}</Mono>
      </View>
    </View>
  );
}

function Segment({
  label,
  sub,
  active,
  onPress,
}: {
  label: string;
  sub: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={`${styles.segmentItem} ${active ? styles.segmentActive : ''}`}>
      <Text className={active ? styles.segmentLabelActive : styles.segmentLabel}>{label}</Text>
      <Text className={styles.segmentSub}>{sub}</Text>
    </TouchableOpacity>
  );
}

function CapacityCard({ capacity }: { capacity: Capacity }) {
  const tone =
    capacity.verdict === 'too-big' ? 'bad' : capacity.verdict === 'tight' ? 'warn' : 'ok';

  const caveat = capacityCaveat(capacity);

  return (
    <View
      className={
        tone === 'bad' ? styles.badCard : tone === 'warn' ? styles.warnCard : styles.okCard
      }>
      <Text
        className={
          tone === 'bad' ? styles.badTitle : tone === 'warn' ? styles.warnTitle : styles.okTitle
        }>
        {capacityTitle(capacity)}
      </Text>
      <Text
        className={
          tone === 'bad' ? styles.badText : tone === 'warn' ? styles.warnText : styles.okText
        }>
        {capacityDetail(capacity)}
      </Text>

      {/* The assumption is restated on every render. The moment this stops
          appearing, a reader starts believing the number was measured. */}
      {caveat && <Text className={styles.caveat}>{caveat}</Text>}
    </View>
  );
}

function Preview({
  kind,
  url,
  vcard,
  capacity,
}: {
  kind: PayloadKind;
  url: string;
  vcard: string;
  capacity: Capacity;
}) {
  const { index, rest } = compressUri(url);

  return (
    <View className="gap-3">
      <Text className={styles.section}>Exactly what goes on the tag</Text>

      <View className={styles.card}>
        {kind === 'url' ? (
          <>
            <Mono className={styles.mono}>{url}</Mono>
            <Text className={styles.note}>
              {index > 0
                ? `Stored as one prefix byte for “${URI_PREFIXES[index]}” plus ${rest.length} characters — the table saves ${URI_PREFIXES[index].length - 1} bytes.`
                : 'No standard prefix applies to this scheme, so the URI is stored in full.'}
            </Text>
          </>
        ) : (
          <Mono className={styles.mono}>{vcard.replace(/\r\n/g, '\n')}</Mono>
        )}
      </View>

      <View className={styles.card}>
        <Row label="NDEF message" value={`${capacity.messageBytes} bytes`} />
        <Row label="Tag framing (TLV)" value={`${capacity.tlvBytes} bytes`} />
        <Row label="Total needed" value={`${capacity.requiredBytes} bytes`} />
        <Row
          label={capacity.basis === 'assumed' ? 'Assumed capacity' : 'Reported capacity'}
          value={`${capacity.budget} bytes`}
        />
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className={styles.row}>
      <Text className={styles.label}>{label}</Text>
      <Text className={styles.value}>{value}</Text>
    </View>
  );
}

const styles = {
  centre: 'flex-1 items-center justify-center gap-3 p-8',
  muted: 'text-sm text-neutral-500 dark:text-neutral-400',
  title: 'text-3xl font-bold text-neutral-900 dark:text-neutral-50',
  subtitle: 'text-base text-neutral-500 dark:text-neutral-400',
  section: 'text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500',
  card: 'rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-4 gap-2',
  row: 'flex-row items-center justify-between gap-4',
  label: 'text-sm text-neutral-500 dark:text-neutral-400',
  value: 'text-sm font-medium text-neutral-900 dark:text-neutral-100',
  mono: 'text-xs text-neutral-700 dark:text-neutral-300',
  note: 'text-xs text-neutral-500 dark:text-neutral-400',

  segment: 'flex-row gap-2',
  segmentItem:
    'flex-1 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3 items-center gap-1',
  segmentActive: 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950',
  segmentLabel: 'text-base font-medium text-neutral-600 dark:text-neutral-400',
  segmentLabelActive: 'text-base font-semibold text-indigo-700 dark:text-indigo-300',
  segmentSub: 'text-xs text-neutral-500 dark:text-neutral-400',

  okCard:
    'rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-4 gap-1',
  okTitle: 'text-sm font-semibold text-emerald-900 dark:text-emerald-300',
  okText: 'text-sm text-emerald-800 dark:text-emerald-400',
  warnCard:
    'rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-4 gap-1',
  warnTitle: 'text-sm font-semibold text-amber-900 dark:text-amber-300',
  warnText: 'text-sm text-amber-800 dark:text-amber-400',
  badCard:
    'rounded-2xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4 gap-1',
  badTitle: 'text-sm font-semibold text-red-900 dark:text-red-300',
  badText: 'text-sm text-red-800 dark:text-red-400',
  caveat: 'text-xs italic text-neutral-600 dark:text-neutral-400 pt-1',

  scanCard:
    'rounded-2xl border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950 p-5 gap-3 items-center',
  scanText: 'text-sm text-indigo-900 dark:text-indigo-300 text-center',
  confirmButton: 'items-center bg-red-600 rounded-2xl px-5 py-4',
  cancelButton: 'items-center rounded-2xl px-5 py-3',
  cancelText: 'text-sm font-medium text-neutral-500 dark:text-neutral-400',
  writeButton: 'items-center bg-indigo-600 rounded-2xl px-5 py-4',
  writeButtonText: 'text-white text-base font-semibold',
  pending: 'text-xs text-neutral-500 dark:text-neutral-400 text-center',

  emptyTitle: 'text-lg font-semibold text-neutral-900 dark:text-neutral-50',
  emptyBody: 'text-sm text-neutral-500 dark:text-neutral-400 text-center',
  linkButton: 'rounded-2xl border border-indigo-300 dark:border-indigo-700 px-4 py-3',
  linkButtonText: 'text-sm font-medium text-indigo-700 dark:text-indigo-300',
};
