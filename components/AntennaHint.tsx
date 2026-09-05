import { Platform, Text, View } from 'react-native';

/**
 * Where the NFC antenna actually is (N5).
 *
 * A small drawing, because "hold the tag near the phone" is not actionable and
 * the answer differs by platform: the iPhone's antenna sits at the **top edge**
 * near the camera, while Android phones almost always put it in the **middle of
 * the back**. Someone holding a tag against the wrong end of the phone
 * concludes the app is broken.
 *
 * Rendered during a scan. It matters far more on Android, where nothing else
 * is on screen — on iOS the system sheet covers most of this anyway, which is
 * itself the point being illustrated.
 */
export const AntennaHint = () => {
  const android = Platform.OS === 'android';

  return (
    <View className={styles.wrapper}>
      <View className={styles.phone}>
        {/* The dot marks the antenna; its position is the whole message. */}
        <View className={android ? styles.dotCentre : styles.dotTop} />
      </View>
      <Text className={styles.caption}>
        {android
          ? 'Antenna is behind the middle of the phone'
          : 'Antenna is at the top edge, near the camera'}
      </Text>
    </View>
  );
};

const styles = {
  wrapper: 'items-center gap-2',
  phone:
    'h-24 w-14 rounded-xl border-2 border-indigo-400 dark:border-indigo-600 items-center justify-start py-2',
  dotTop: 'h-3 w-3 rounded-full bg-indigo-500',
  dotCentre: 'h-3 w-3 rounded-full bg-indigo-500 mt-8',
  caption: 'text-xs text-indigo-900/70 dark:text-indigo-300/70 text-center',
};
