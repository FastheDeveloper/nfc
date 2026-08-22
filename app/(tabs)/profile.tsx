import { Text, View } from 'react-native';

import { Container } from '../../components/Container';

export default function ProfileScreen() {
  return (
    <Container>
      <View className="flex-1 items-center justify-center gap-2 p-5">
        <Text className={styles.title}>Profile</Text>
        <Text className={styles.body}>The profile editor arrives in Phase 3.</Text>
      </View>
    </Container>
  );
}

const styles = {
  title: 'text-xl font-semibold text-neutral-900 dark:text-neutral-50',
  body: 'text-sm text-neutral-500 dark:text-neutral-400 text-center',
};
