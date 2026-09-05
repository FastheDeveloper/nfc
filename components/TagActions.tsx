import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Linking, Share, Text, TouchableOpacity, View } from 'react-native';

interface TagActionsProps {
  /** The decoded value worth copying — a URL, some text, a vCard body. */
  value?: string;
  /** Present only when the value is a URI we could actually open. */
  uri?: string;
  /** The raw tag object, for sharing out of the app. */
  raw: unknown;
}

/**
 * The three things you want to do with a tag you have just read (N1, N2, N6).
 *
 * `Share` is React Native's built-in module, not a dependency — it hands the
 * raw JSON to the OS share sheet, which is how tag dumps get out of the phone
 * and into PLATFORM-NOTES without retyping a hex string by hand.
 *
 * `Linking.openURL` is guarded by `canOpenURL`: a tag can hold any scheme at
 * all, including ones no app on the device handles, and calling `openURL`
 * blindly rejects with an error the user cannot act on.
 */
export const TagActions = ({ value, uri, raw }: TagActionsProps) => {
  const [copied, setCopied] = useState(false);

  async function copy(text: string) {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function open(url: string) {
    if (await Linking.canOpenURL(url)) await Linking.openURL(url);
  }

  return (
    <View className={styles.row}>
      {uri && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => open(uri)}
          className={styles.action}>
          <Text className={styles.actionText}>Open link</Text>
        </TouchableOpacity>
      )}

      {value && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => copy(value)}
          className={styles.action}>
          <Text className={styles.actionText}>{copied ? 'Copied' : 'Copy'}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => Share.share({ message: JSON.stringify(raw, null, 2) })}
        className={styles.action}>
        <Text className={styles.actionText}>Share raw</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = {
  row: 'flex-row flex-wrap gap-2',
  action:
    'rounded-xl border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950 px-3 py-2',
  actionText: 'text-xs font-medium text-indigo-800 dark:text-indigo-300',
};
