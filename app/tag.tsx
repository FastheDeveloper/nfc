import { Stack, useRouter } from 'expo-router';
import { Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { Collapsible } from '../components/Collapsible';
import { Container } from '../components/Container';
import { Mono } from '../components/Mono';
import { TagActions } from '../components/TagActions';
import { guessChip } from '../lib/manufacturer';
import { bytesToHex, describeView, kindLabel, typeToString, type NdefView } from '../lib/ndef';
import { tagFacts, type Fact, type TargetOs } from '../lib/tagFacts';
import { useTagStore } from '../store/tag';

/**
 * Tag Info — everything we know about the last tag, and everything we don't.
 *
 * The "don't" half is the point. Rows whose value the platform never reported
 * stay visible and say why (see `lib/tagFacts.ts`), because on iOS the absence
 * of a capacity figure is a finding about CoreNFC, not a rendering accident.
 */
export default function TagScreen() {
  const router = useRouter();
  const tag = useTagStore((s) => s.tag);
  const views = useTagStore((s) => s.views);
  const scannedAt = useTagStore((s) => s.scannedAt);

  // `Platform.OS` widens to include 'web' and others this project never targets.
  const os: TargetOs = Platform.OS === 'android' ? 'android' : 'ios';

  if (!tag) {
    return (
      <Container>
        <Stack.Screen options={{ title: 'Tag Info' }} />
        <View className={styles.empty}>
          <Text className={styles.emptyTitle}>No tag scanned yet</Text>
          <Text className={styles.emptyBody}>
            Scan a tag on the Read tab and its details will appear here.
          </Text>
        </View>
      </Container>
    );
  }

  const facts = tagFacts(tag, os);
  const records = tag.ndefMessage ?? [];
  const chip = guessChip(tag.id);

  // The first thing worth copying or opening: a URI if there is one, otherwise
  // whatever the first record decoded to.
  const firstUri = views.find((v) => v.kind === 'uri');
  const copyValue = views.length ? describeView(views[0]) : undefined;

  return (
    <Container>
      <Stack.Screen options={{ title: 'Tag Info' }} />

      <ScrollView contentContainerClassName="p-5 gap-6">
        <Section title="Identity">
          <View className={styles.card}>
            {facts.map((fact) => (
              <FactRow key={fact.label} fact={fact} />
            ))}

            {chip && (
              <View className="gap-1">
                <View className={styles.row}>
                  <Text className={styles.label}>Chip</Text>
                  <Text className={styles.value}>{chip.family ?? chip.manufacturer}</Text>
                </View>
                <Text className={styles.unavailable}>
                  {chip.family ? `${chip.manufacturer} · ` : ''}inferred from the UID prefix, not
                  read from the tag
                </Text>
              </View>
            )}
          </View>

          <TagActions
            value={copyValue}
            uri={firstUri?.kind === 'uri' ? firstUri.uri : undefined}
            raw={tag}
          />
          {scannedAt != null && (
            <Text className={styles.timestamp}>
              Scanned at {new Date(scannedAt).toLocaleTimeString()}
            </Text>
          )}
        </Section>

        <Section title={views.length ? `Records (${views.length})` : 'Records'}>
          {views.length === 0 ? (
            <View className={styles.card}>
              <Text className={styles.emptyRecord}>
                This tag is NDEF formatted but holds no records yet. Writing arrives in Phase 3.
              </Text>
            </View>
          ) : (
            views.map((view, i) => (
              <RecordCard
                key={i}
                index={i}
                view={view}
                type={typeToString(records[i]?.type)}
                payload={records[i]?.payload as number[] | undefined}
              />
            ))
          )}
        </Section>

        {/* Reached from here rather than a tab: nothing destructive should be
            one tap from the app's home screen. */}
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => router.push('/lock')}
          className={styles.lockLink}>
          <Text className={styles.lockLinkText}>Lock this tag permanently…</Text>
        </TouchableOpacity>

        <Section title="Raw">
          <View className={styles.card}>
            <Collapsible title="Tag object as returned by the native side">
              <Mono className={styles.mono}>{JSON.stringify(tag, null, 2)}</Mono>
            </Collapsible>
          </View>
        </Section>
      </ScrollView>
    </Container>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3">
      <Text className={styles.section}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * One fact.
 *
 * Three renderings, not two: a value, or an explanation of why there is no
 * value, plus an optional footnote. A row is never silently blank.
 */
function FactRow({ fact }: { fact: Fact }) {
  return (
    <View className="gap-1">
      <View className={styles.row}>
        <Text className={styles.label}>{fact.label}</Text>
        {fact.value != null ? (
          <Text className={styles.value}>{fact.value}</Text>
        ) : (
          <Text className={styles.notReported}>Not reported</Text>
        )}
      </View>

      {fact.value == null && fact.unavailable && (
        <Text className={styles.unavailable}>{fact.unavailable}</Text>
      )}
      {fact.footnote && <Text className={styles.footnote}>{fact.footnote}</Text>}
    </View>
  );
}

function RecordCard({
  index,
  view,
  type,
  payload,
}: {
  index: number;
  view: NdefView;
  type: string;
  payload: number[] | undefined;
}) {
  return (
    <View className={styles.card}>
      <View className={styles.row}>
        <Text className={styles.label}>Record {index + 1}</Text>
        <Text className={styles.kind}>{kindLabel(view)}</Text>
      </View>

      <Text className={styles.decoded}>{describeView(view)}</Text>

      {view.kind === 'aar' && (
        <Text className={styles.footnote}>
          Android launches this app when the tag is tapped. iOS ignores the record entirely.
        </Text>
      )}

      <Collapsible title="Bytes">
        <Mono className={styles.mono}>type: {type || '(none)'}</Mono>
        <Mono className={styles.mono}>payload ({payload?.length ?? 0} bytes):</Mono>
        <Mono className={styles.mono}>{bytesToHex(payload)}</Mono>
      </Collapsible>
    </View>
  );
}

const styles = {
  section: 'text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500',
  card: 'rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-4 gap-3',
  row: 'flex-row items-start justify-between gap-4',
  label: 'text-sm text-neutral-500 dark:text-neutral-400',
  value: 'text-sm font-medium text-neutral-900 dark:text-neutral-100 flex-1 text-right',
  kind: 'text-xs text-neutral-500 dark:text-neutral-400 flex-1 text-right',
  notReported: 'text-sm italic text-neutral-400 dark:text-neutral-600 flex-1 text-right',
  unavailable: 'text-xs text-neutral-500 dark:text-neutral-400',
  footnote: 'text-xs italic text-indigo-700 dark:text-indigo-400',
  decoded: 'text-base text-neutral-900 dark:text-neutral-100',
  mono: 'text-xs text-neutral-600 dark:text-neutral-400',
  timestamp: 'text-xs text-neutral-400 dark:text-neutral-500',
  empty: 'flex-1 items-center justify-center gap-2 p-8',
  emptyTitle: 'text-lg font-semibold text-neutral-900 dark:text-neutral-50',
  emptyBody: 'text-sm text-neutral-500 dark:text-neutral-400 text-center',
  emptyRecord: 'text-sm text-neutral-500 dark:text-neutral-400',
  lockLink: 'rounded-2xl border border-red-200 dark:border-red-900 px-4 py-3 items-center',
  lockLinkText: 'text-sm font-medium text-red-700 dark:text-red-400',
};
