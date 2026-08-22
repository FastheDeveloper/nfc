import * as Device from 'expo-device';
import { Platform, Text, View } from 'react-native';

/**
 * Phase 0 sanity check: proves the bundle is running on the physical device we
 * think it is. Deliberately shows `Device.isDevice` — NFC does not work on the
 * iOS Simulator or the Android emulator, so "is this real hardware?" is a
 * question this project has to keep answering.
 */
export const DeviceBanner = () => {
  const rows: [string, string][] = [
    ['Platform', `${Platform.OS} ${Platform.Version}`],
    ['Device', Device.modelName ?? 'unknown'],
    ['OS', `${Device.osName ?? '?'} ${Device.osVersion ?? ''}`.trim()],
    ['Real hardware', Device.isDevice ? 'yes' : 'NO — simulator/emulator'],
  ];

  return (
    <View className={styles.card}>
      {rows.map(([label, value]) => (
        <View key={label} className={styles.row}>
          <Text className={styles.label}>{label}</Text>
          <Text className={styles.value}>{value}</Text>
        </View>
      ))}
    </View>
  );
};

const styles = {
  card: 'rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-4 gap-2',
  row: 'flex-row items-center justify-between gap-4',
  label: 'text-sm text-neutral-500 dark:text-neutral-400',
  value: 'text-sm font-medium text-neutral-900 dark:text-neutral-100',
};
