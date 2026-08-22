import { ScrollView, Text, View } from 'react-native';

import { Container } from '../../components/Container';
import { DeviceBanner } from '../../components/DeviceBanner';

export default function ReadScreen() {
  return (
    <Container>
      <ScrollView contentContainerClassName="p-5 gap-5">
        <View className="gap-1">
          <Text className={styles.title}>TapCard</Text>
          <Text className={styles.subtitle}>
            An NFC digital business card. Phase 0 — the app boots.
          </Text>
        </View>

        <DeviceBanner />

        <View className={styles.note}>
          <Text className={styles.noteText}>
            Reading tags arrives in Phase 1, once react-native-nfc-manager and the NFC entitlement
            are wired up.
          </Text>
        </View>
      </ScrollView>
    </Container>
  );
}

const styles = {
  title: 'text-3xl font-bold text-neutral-900 dark:text-neutral-50',
  subtitle: 'text-base text-neutral-500 dark:text-neutral-400',
  note: 'rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 p-4',
  noteText: 'text-sm text-neutral-500 dark:text-neutral-400',
};
