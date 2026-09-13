import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Collapsible } from '../../components/Collapsible';
import { Container } from '../../components/Container';
import { ErrorCard } from '../../components/ErrorCard';
import {
  describeSession,
  focusStats,
  formatDuration,
  verdictForTap,
  type FocusSession,
} from '../../lib/focus';
import { readTag } from '../../lib/nfcBackend';
import { isCancellation, toScanError, type ScanError } from '../../lib/scanError';
import { useFocusStore } from '../../store/focus';

/**
 * Focus — a session you cannot end without walking to the tag.
 *
 * The interesting part of this screen is how little it enforces. It cannot stop
 * you opening anything else; blocking other apps on iOS needs Apple's
 * `com.apple.developer.family-controls` entitlement, which is reviewed
 * individually and granted only to apps whose core purpose is digital
 * wellbeing. Foqos has it. We do not, and pretending otherwise would be a
 * promise the reader could not reproduce.
 *
 * So it enforces the one thing it honestly can: **the record**. You can walk
 * away, and it will say you walked away, permanently, and you will see it next
 * time you open the tab. Not prevention — accounting.
 */
export default function FocusScreen() {
  const hasHydrated = useFocusStore((s) => s.hasHydrated);
  const boundTagId = useFocusStore((s) => s.boundTagId);
  const session = useFocusStore((s) => s.session);
  const history = useFocusStore((s) => s.history);

  const bindTag = useFocusStore((s) => s.bindTag);
  const startSession = useFocusStore((s) => s.startSession);
  const endSession = useFocusStore((s) => s.endSession);
  const breakSession = useFocusStore((s) => s.breakSession);
  const clearHistory = useFocusStore((s) => s.clearHistory);

  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<ScanError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [breaking, setBreaking] = useState(false);
  const [reason, setReason] = useState('');
  // Starts at 0, not Date.now(): reading the clock during render is impure and
  // the React Compiler rejects it. The effect below sets it immediately, so the
  // only cost is one frame showing "0s".
  const [now, setNow] = useState(0);

  // Ticks only while a session is running. The elapsed label updates once a
  // second; nothing else on the screen depends on the clock.
  useEffect(() => {
    if (!session) return;

    // Deferred rather than called straight away: a synchronous setState inside
    // an effect cascades a second render pass. A zero timeout hands it to the
    // next task, which updates just as promptly without the cascade.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [session]);

  if (!hasHydrated) {
    return (
      <Container>
        <View className={styles.centre}>
          <Text className={styles.muted}>Loading your record…</Text>
        </View>
      </Container>
    );
  }

  async function handleTap() {
    setError(null);
    setMessage(null);
    setScanning(true);

    try {
      const { tag } = await readTag();
      if (!tag?.id) {
        setMessage('That tag reported no identifier, so it cannot be used as a key.');
        return;
      }

      // Every decision about what a tap means lives in lib/focus.ts, so this
      // screen only has to render the outcome.
      const verdict = verdictForTap(tag.id, boundTagId, session !== null);

      switch (verdict.action) {
        case 'bind':
          bindTag(tag.id);
          setMessage('Tag paired. Put it somewhere inconvenient — that is the point.');
          break;
        case 'start':
          startSession(tag.id);
          setMessage(null);
          break;
        case 'end':
          endSession();
          setMessage('Session complete.');
          break;
        case 'wrong-tag':
          setMessage('That is not your focus tag. Only the paired one counts.');
          break;
      }
    } catch (e) {
      if (isCancellation(e)) return;
      setError(toScanError(e));
    } finally {
      setScanning(false);
    }
  }

  const stats = focusStats(history);
  const elapsed = session && now ? now - session.startedAt : 0;

  return (
    <Container>
      <ScrollView contentContainerClassName="p-5 gap-5">
        <View className="gap-1">
          <Text className={styles.title}>Focus</Text>
          <Text className={styles.subtitle}>
            {session
              ? 'Tap the tag to finish. It is where you left it.'
              : 'Tap your tag to start. Leave it somewhere you would rather not walk to.'}
          </Text>
        </View>

        {session ? (
          <View className={styles.activeCard}>
            <Text className={styles.elapsed}>{formatDuration(elapsed)}</Text>
            <Text className={styles.activeLabel}>focused</Text>
          </View>
        ) : (
          <StatsRow stats={stats} />
        )}

        <TouchableOpacity
          accessibilityRole="button"
          disabled={scanning}
          onPress={handleTap}
          className={`${session ? styles.endButton : styles.startButton} ${scanning ? 'opacity-40' : ''}`}>
          {scanning ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className={styles.buttonText}>
              {!boundTagId ? 'Pair a tag' : session ? 'Tap tag to finish' : 'Tap tag to start'}
            </Text>
          )}
        </TouchableOpacity>

        {message && <Text className={styles.message}>{message}</Text>}
        {error && <ErrorCard error={error} />}

        {/* The escape hatch. Present, because a commitment device with no way
            out is one you uninstall the first time you are genuinely stuck —
            and hidden behind two steps, because it should feel like a decision. */}
        {session && (
          <View className="gap-2">
            {breaking ? (
              <View className={styles.breakCard}>
                <Text className={styles.breakTitle}>End without the tag?</Text>
                <Text className={styles.breakBody}>
                  This session will be recorded as ended early. That mark is permanent and you will
                  see it every time you open this tab.
                </Text>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Why? (optional)"
                  placeholderTextColor="#a1a1aa"
                  className={styles.input}
                  accessibilityLabel="Reason for ending early"
                />
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => {
                      breakSession(reason);
                      setReason('');
                      setBreaking(false);
                      setMessage('Recorded as ended early.');
                    }}
                    className={styles.confirmBreak}>
                    <Text className={styles.buttonText}>End early</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => setBreaking(false)}
                    className={styles.keepGoing}>
                    <Text className={styles.keepGoingText}>Keep going</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => setBreaking(true)}
                className={styles.escapeLink}>
                <Text className={styles.escapeText}>I cannot reach my tag</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {history.length > 0 && (
          <View className="gap-3">
            <Text className={styles.section}>The record</Text>
            {history.slice(0, 12).map((entry) => (
              <HistoryRow key={entry.id} session={entry} />
            ))}

            {/* Clearing the record costs exactly what earning it did: the walk.
                A history you can wipe from the sofa records nothing. */}
            <Collapsible title="Clear the record">
              <Text className={styles.breakBody}>
                Erasing this needs the tag, for the same reason ending a session does.
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={async () => {
                  setError(null);
                  setScanning(true);
                  try {
                    const { tag } = await readTag();
                    const cleared = tag?.id ? clearHistory(tag.id) : false;
                    setMessage(cleared ? 'Record cleared.' : 'That is not your focus tag.');
                  } catch (e) {
                    if (!isCancellation(e)) setError(toScanError(e));
                  } finally {
                    setScanning(false);
                  }
                }}
                className={styles.escapeLink}>
                <Text className={styles.escapeText}>Tap tag to clear</Text>
              </TouchableOpacity>
            </Collapsible>
          </View>
        )}

        {!boundTagId && (
          <Text className={styles.footnote}>
            The tag is only a key, not a lock. Its identifier can be copied in seconds with cheap
            hardware — see the handbook on why that matters and what a cryptographic tag does
            instead.
          </Text>
        )}
      </ScrollView>
    </Container>
  );
}

function StatsRow({ stats }: { stats: ReturnType<typeof focusStats> }) {
  if (stats.sessions === 0) {
    return (
      <View className={styles.card}>
        <Text className={styles.muted}>No sessions yet. Pair a tag to begin.</Text>
      </View>
    );
  }

  return (
    <View className={styles.card}>
      <View className={styles.row}>
        <Stat label="Focused" value={formatDuration(stats.totalMs)} />
        <Stat label="Streak" value={String(stats.streak)} />
        <Stat label="Ended early" value={String(stats.broken)} />
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 items-center gap-1">
      <Text className={styles.statValue}>{value}</Text>
      <Text className={styles.statLabel}>{label}</Text>
    </View>
  );
}

function HistoryRow({ session }: { session: FocusSession }) {
  const broken = session.outcome === 'broken';

  return (
    <View className={broken ? styles.brokenRow : styles.card}>
      <View className={styles.row}>
        <Text className={broken ? styles.brokenText : styles.value}>
          {describeSession(session)}
        </Text>
        <Text className={styles.timestamp}>
          {new Date(session.startedAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
          })}
        </Text>
      </View>
      {session.reason && <Text className={styles.reason}>“{session.reason}”</Text>}
    </View>
  );
}

const styles = {
  centre: 'flex-1 items-center justify-center p-8',
  muted: 'text-sm text-neutral-500 dark:text-neutral-400',
  title: 'text-3xl font-bold text-neutral-900 dark:text-neutral-50',
  subtitle: 'text-base text-neutral-500 dark:text-neutral-400',
  section: 'text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500',
  card: 'rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-4 gap-2',
  row: 'flex-row items-center justify-between gap-4',
  value: 'text-sm font-medium text-neutral-900 dark:text-neutral-100',
  timestamp: 'text-xs text-neutral-400 dark:text-neutral-500',
  statValue: 'text-2xl font-bold text-neutral-900 dark:text-neutral-50',
  statLabel: 'text-xs text-neutral-500 dark:text-neutral-400',

  activeCard:
    'rounded-2xl border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950 p-8 items-center gap-1',
  elapsed: 'text-5xl font-bold text-indigo-700 dark:text-indigo-300',
  activeLabel: 'text-sm text-indigo-800/70 dark:text-indigo-400/70',

  startButton: 'items-center bg-indigo-600 rounded-2xl px-5 py-4',
  endButton: 'items-center bg-emerald-600 rounded-2xl px-5 py-4',
  buttonText: 'text-white text-base font-semibold',
  message: 'text-sm text-neutral-600 dark:text-neutral-400 text-center',

  escapeLink: 'items-center py-3',
  escapeText: 'text-sm text-neutral-400 dark:text-neutral-500 underline',
  breakCard:
    'rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-4 gap-3',
  breakTitle: 'text-sm font-semibold text-amber-900 dark:text-amber-300',
  breakBody: 'text-sm text-amber-800 dark:text-amber-400',
  input:
    'rounded-xl border border-amber-300 dark:border-amber-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100',
  confirmBreak: 'flex-1 items-center bg-amber-600 rounded-xl px-4 py-3',
  keepGoing:
    'flex-1 items-center rounded-xl px-4 py-3 border border-neutral-300 dark:border-neutral-700',
  keepGoingText: 'text-sm font-medium text-neutral-600 dark:text-neutral-400',

  brokenRow:
    'rounded-2xl border border-amber-300/60 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/40 p-4 gap-2',
  brokenText: 'text-sm font-medium text-amber-900 dark:text-amber-400',
  reason: 'text-xs italic text-neutral-500 dark:text-neutral-400',
  footnote: 'text-xs text-neutral-400 dark:text-neutral-500',
};
