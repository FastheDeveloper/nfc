import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Confirming a successful read by feel (N3).
 *
 * Android only, and that restriction is the interesting part rather than an
 * oversight.
 *
 * On iOS, CoreNFC owns the interaction: it draws the sheet, plays its own
 * haptic and shows a checkmark the moment a tag is read. Adding a second
 * buzz on top would be a double tap for one event — worse than nothing.
 *
 * On Android nothing happens at all. Foreground dispatch is silent, the app
 * draws its own scanning UI, and a user holding a phone against a tag has no
 * signal that it worked except the screen they may not be looking at. The
 * feedback the OS gives away for free on one platform has to be built on the
 * other.
 *
 * Same asymmetry as the scanning UI itself (PLATFORM-NOTES §3), one layer down.
 */
export async function confirmRead(): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // A device without a vibrator, or one that refuses. Never worth failing a
    // successful scan over.
  }
}
