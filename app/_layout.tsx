import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { startNfc } from '../lib/nfc';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  useEffect(() => {
    // `NfcManager.start()` initialises the native adapter and must run once,
    // before any other NFC call. Doing it here means every screen can assume
    // it has already happened. `startNfc` memoises and never rejects, so a
    // device without NFC hardware simply resolves to `false`.
    startNfc();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}
