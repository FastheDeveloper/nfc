import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';

import { Container } from '../components/Container';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <Container>
        <View className="flex-1 items-center justify-center gap-4 p-5">
          <Text className={styles.title}>This screen doesn&apos;t exist.</Text>
          <Link href="/">
            <Text className={styles.linkText}>Go to the home screen</Text>
          </Link>
        </View>
      </Container>
    </>
  );
}

const styles = {
  title: 'text-xl font-bold text-neutral-900 dark:text-neutral-50',
  linkText: 'text-base text-indigo-600 dark:text-indigo-400',
};
