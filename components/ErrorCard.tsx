import { Text, View } from 'react-native';

import type { ScanError } from '../lib/scanError';
import { Collapsible } from './Collapsible';
import { Mono } from './Mono';

interface ErrorCardProps {
  error: ScanError;
}

/**
 * A failed scan, explained.
 *
 * Phase 1 rendered `err.message` straight into this slot and showed nothing at
 * all, because every error class in the library carries an empty message
 * (DEVLOG §1.13). The fix is not "render something anyway" — it is to say
 * something true and useful, and keep the raw evidence one tap away.
 *
 * The developer detail is not decoration. It is where the article gets its
 * screenshot proving these errors are nameless, and it is what makes a bug
 * report from a reader actionable. It stays collapsed because a user does not
 * need to know what an `NfcError.TagConnectionLost` is to understand "hold the
 * tag still".
 *
 * A cancellation never reaches this component — the Read screen returns early.
 * See `isCancellation`.
 */
export const ErrorCard = ({ error }: ErrorCardProps) => (
  <View className={styles.card}>
    <Text className={styles.title}>{error.title}</Text>
    <Text className={styles.detail}>{error.detail}</Text>

    <Collapsible title="Developer detail">
      <Mono className={styles.mono}>{error.developer}</Mono>
      <Mono className={styles.mono}>kind: {error.kind}</Mono>
      {error.provisional && (
        <Mono className={styles.provisional}>
          provisional: this mapping was read from the library&rsquo;s source and has not yet been
          confirmed on hardware
        </Mono>
      )}
    </Collapsible>
  </View>
);

const styles = {
  card: 'rounded-2xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4 gap-2',
  title: 'text-sm font-semibold text-red-900 dark:text-red-300',
  detail: 'text-sm text-red-800 dark:text-red-400',
  mono: 'text-xs text-red-900/70 dark:text-red-300/70',
  provisional: 'text-xs italic text-red-900/60 dark:text-red-300/60',
};
