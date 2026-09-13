import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Container } from '../components/Container';
import { ErrorCard } from '../components/ErrorCard';
import { Mono } from '../components/Mono';
import { describeStatus, LOCK_WARNING, lockGate, lockVerified } from '../lib/lock';
import { decodeMessage, summarise } from '../lib/ndef';
import { lockTag, readTag } from '../lib/nfcBackend';
import { isCancellation, toScanError, type ScanError } from '../lib/scanError';

/**
 * The only screen in the app that destroys something.
 *
 * Everything else here is reversible: a write can be overwritten, a profile
 * re-typed, a focus record cleared. Locking burns the chip's lock bits. It is a
 * hardware change, and no software on any phone can undo it.
 *
 * So the interaction is deliberately unlike every other screen:
 *
 *   - You must **read the tag first**. You cannot lock a tag you have not
 *     looked at, because the thing most likely to go wrong is not a change of
 *     heart — it is locking the wrong chip.
 *   - The app shows **what is currently on it**, so an unintended tag announces
 *     itself.
 *   - You must **type the tag's own identifier** to enable the button. Modelled
 *     on deleting a GitHub repository, and for the same reason: a confirmation
 *     dialog measures willingness, while typing the name measures attention.
 *   - The warning says *permanently*, *never* and *no undo*, in those words.
 *
 * It is reached from Tag Info rather than a tab. Nothing destructive should be
 * one tap from the app's home screen.
 */
export default function LockScreen() {
  const [scanning, setScanning] = useState(false);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<ScanError | null>(null);

  const [tagId, setTagId] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [contents, setContents] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const gate = lockGate(tagId, status, typed);

  async function inspect() {
    setError(null);
    setResult(null);
    setScanning(true);

    try {
      const { tag } = await readTag();
      if (!tag?.id) {
        setResult('That tag reported no identifier.');
        return;
      }

      setTagId(tag.id);
      setStatus(typeof tag.isWritable === 'boolean' ? (tag.isWritable ? 2 : 3) : null);
      setContents(summarise(decodeMessage(tag.ndefMessage)));
      setTyped('');
    } catch (e) {
      if (!isCancellation(e)) setError(toScanError(e));
    } finally {
      setScanning(false);
    }
  }

  async function performLock() {
    setError(null);
    setResult(null);
    setLocking(true);

    try {
      const outcome = await lockTag();

      // A false `verified` is not a soft warning here. If the status did not
      // come back read-only, the chip's state is unknown — and you cannot retry
      // to find out, because retrying is the destructive act.
      setStatus(outcome.statusAfter);
      setResult(
        lockVerified(outcome.statusAfter)
          ? 'Locked, and confirmed read-only. This tag can never be written again.'
          : 'The lock command completed but the tag did not confirm read-only. Read it again before relying on it.'
      );
      setTyped('');
    } catch (e) {
      if (!isCancellation(e)) setError(toScanError(e));
    } finally {
      setLocking(false);
    }
  }

  return (
    <Container>
      <Stack.Screen options={{ title: 'Lock a tag' }} />

      <ScrollView contentContainerClassName="p-5 gap-5">
        <View className={styles.dangerCard}>
          <Text className={styles.dangerTitle}>This cannot be undone</Text>
          <Text className={styles.dangerBody}>{LOCK_WARNING}</Text>
          <Text className={styles.dangerBody}>
            Use a tag you have decided to spend. Real deployments lock tags on purpose — event
            badges, product seals, museum labels — because a tag anyone can rewrite is a tag anyone
            will.
          </Text>
        </View>

        {/* Step 1. You cannot lock what you have not looked at. */}
        <TouchableOpacity
          accessibilityRole="button"
          disabled={scanning || locking}
          onPress={inspect}
          className={`${styles.inspectButton} ${scanning ? 'opacity-40' : ''}`}>
          {scanning ? (
            <ActivityIndicator />
          ) : (
            <Text className={styles.inspectText}>
              {tagId ? 'Read a different tag' : 'Read the tag first'}
            </Text>
          )}
        </TouchableOpacity>

        {error && <ErrorCard error={error} />}

        {tagId && (
          <View className={styles.card}>
            <Row label="Identifier" value={tagId} mono />
            <Row label="Status" value={describeStatus(status)} />
            <Row label="Currently holds" value={contents ?? '—'} />
          </View>
        )}

        {gate.state === 'already-locked' && (
          <View className={styles.okCard}>
            <Text className={styles.okTitle}>Already locked</Text>
            <Text className={styles.okBody}>
              This tag is permanently read-only. Nothing to do, and nothing was changed.
            </Text>
          </View>
        )}

        {gate.state === 'not-lockable' && (
          <View className={styles.warnCard}>
            <Text className={styles.warnTitle}>Not an NDEF tag</Text>
            <Text className={styles.warnBody}>There is no NDEF lock to apply to this chip.</Text>
          </View>
        )}

        {(gate.state === 'needs-confirmation' || gate.state === 'armed') && (
          <View className="gap-3">
            <Text className={styles.section}>Type the identifier to continue</Text>
            <Text className={styles.hint}>
              Typing it is how you prove you are holding the tag you think you are.
            </Text>

            <TextInput
              value={typed}
              onChangeText={setTyped}
              placeholder={tagId ?? ''}
              placeholderTextColor="#a1a1aa"
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Tag identifier confirmation"
              className={styles.input}
            />

            <TouchableOpacity
              accessibilityRole="button"
              disabled={gate.state !== 'armed' || locking}
              onPress={performLock}
              className={`${styles.lockButton} ${gate.state !== 'armed' || locking ? 'opacity-30' : ''}`}>
              {locking ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className={styles.lockText}>Lock this tag forever</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {result && (
          <View className={styles.card}>
            <Text className={styles.value}>{result}</Text>
          </View>
        )}
      </ScrollView>
    </Container>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View className={styles.row}>
      <Text className={styles.label}>{label}</Text>
      {mono ? (
        <Mono className={styles.monoValue}>{value}</Mono>
      ) : (
        <Text className={styles.value}>{value}</Text>
      )}
    </View>
  );
}

const styles = {
  section: 'text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500',
  hint: 'text-xs text-neutral-500 dark:text-neutral-400',
  card: 'rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-4 gap-2',
  row: 'flex-row items-start justify-between gap-4',
  label: 'text-sm text-neutral-500 dark:text-neutral-400',
  value: 'text-sm font-medium text-neutral-900 dark:text-neutral-100 flex-1 text-right',
  monoValue: 'text-xs text-neutral-900 dark:text-neutral-100 flex-1 text-right',

  dangerCard:
    'rounded-2xl border-2 border-red-400 dark:border-red-700 bg-red-50 dark:bg-red-950 p-4 gap-2',
  dangerTitle: 'text-base font-bold text-red-900 dark:text-red-300',
  dangerBody: 'text-sm text-red-800 dark:text-red-400',

  inspectButton:
    'items-center rounded-2xl border border-neutral-300 dark:border-neutral-700 px-5 py-4',
  inspectText: 'text-base font-medium text-neutral-800 dark:text-neutral-200',

  input:
    'rounded-2xl border border-red-300 dark:border-red-800 bg-white dark:bg-neutral-900 px-4 py-3 text-base text-neutral-900 dark:text-neutral-100',
  lockButton: 'items-center bg-red-600 rounded-2xl px-5 py-4',
  lockText: 'text-white text-base font-bold',

  okCard:
    'rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-4 gap-1',
  okTitle: 'text-sm font-semibold text-emerald-900 dark:text-emerald-300',
  okBody: 'text-sm text-emerald-800 dark:text-emerald-400',
  warnCard:
    'rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-4 gap-1',
  warnTitle: 'text-sm font-semibold text-amber-900 dark:text-amber-300',
  warnBody: 'text-sm text-amber-800 dark:text-amber-400',
};
