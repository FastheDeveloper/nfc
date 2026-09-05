import { Platform, Text, type TextProps } from 'react-native';

/**
 * Monospaced text.
 *
 * Tailwind's `font-mono` is a *web* font stack ("ui-monospace, SFMono-Regular,
 * Menlo, …"). React Native's `fontFamily` takes exactly one real family name and
 * silently ignores anything it cannot resolve, so `font-mono` renders as the
 * default sans font on a device — the hex dumps stop lining up and nothing warns
 * you.
 *
 * The correct family name also differs per platform: iOS ships Menlo, Android
 * resolves the generic alias `monospace`.
 */
const family = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export const Mono = ({ style, ...props }: TextProps) => (
  <Text {...props} style={[{ fontFamily: family }, style]} />
);
