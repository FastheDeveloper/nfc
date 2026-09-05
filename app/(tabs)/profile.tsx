import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type KeyboardTypeOptions,
} from 'react-native';

import { Container } from '../../components/Container';
import { assessCapacity } from '../../lib/capacity';
import { mimeRecord } from '../../lib/ndefEncode';
import { toVCard } from '../../lib/vcard';
import { isProfileEmpty, useProfileStore, type Profile } from '../../store/profile';

type FieldSpec = {
  key: keyof Profile;
  label: string;
  placeholder: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'words' | 'sentences';
  multiline?: boolean;
};

/**
 * Seven fields, in the order they appear on a real card.
 *
 * Each one costs bytes on a tag with about 144 of them, which is why the
 * running size sits at the top of this screen rather than being a surprise on
 * the Write tab.
 */
const FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Name', placeholder: 'Farouq Seriki', autoCapitalize: 'words' },
  { key: 'title', label: 'Job title', placeholder: 'Engineer', autoCapitalize: 'words' },
  { key: 'company', label: 'Company', placeholder: 'Recdek', autoCapitalize: 'words' },
  {
    key: 'phone',
    label: 'Phone',
    placeholder: '+44 20 7123 4567',
    keyboardType: 'phone-pad',
    autoCapitalize: 'none',
  },
  {
    key: 'email',
    label: 'Email',
    placeholder: 'you@example.com',
    keyboardType: 'email-address',
    autoCapitalize: 'none',
  },
  {
    key: 'url',
    label: 'Link',
    placeholder: 'https://example.com',
    keyboardType: 'url',
    autoCapitalize: 'none',
  },
  {
    key: 'note',
    label: 'Note',
    placeholder: 'Anything else worth carrying',
    autoCapitalize: 'sentences',
    multiline: true,
  },
];

export default function ProfileScreen() {
  const profile = useProfileStore((s) => s.profile);
  const hasHydrated = useProfileStore((s) => s.hasHydrated);
  const setField = useProfileStore((s) => s.setField);
  const reset = useProfileStore((s) => s.reset);

  const [confirmingReset, setConfirmingReset] = useState(false);

  /**
   * Do not render the form until AsyncStorage has answered.
   *
   * This is a correctness guard, not a nicety. Before hydration the store
   * legitimately holds empty defaults, and a form rendered over those will
   * write them back the instant the user touches any field — silently
   * destroying a saved profile, and only ever on a cold launch.
   */
  if (!hasHydrated) {
    return (
      <Container>
        <View className={styles.centre}>
          <Text className={styles.muted}>Loading your card…</Text>
        </View>
      </Container>
    );
  }

  const capacity = assessCapacity([mimeRecord('text/vcard', toVCard(profile))]);
  const empty = isProfileEmpty(profile);

  return (
    <Container>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerClassName="p-5 gap-5"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive">
          <View className="gap-1">
            <Text className={styles.title}>Your card</Text>
            <Text className={styles.subtitle}>
              Saved as you type. Nothing leaves the device until you write it to a tag.
            </Text>
          </View>

          {/* The size is here, not only on Write, because this is the screen
              where it changes. A field that pushes the card over the budget
              should say so while you are typing it. */}
          {!empty && (
            <View className={capacity.verdict === 'too-big' ? styles.sizeWarn : styles.sizeOk}>
              <Text
                className={
                  capacity.verdict === 'too-big' ? styles.sizeWarnText : styles.sizeOkText
                }>
                vCard: {capacity.requiredBytes} bytes
                {capacity.verdict === 'too-big'
                  ? ` · ${Math.abs(capacity.headroom)} over an NTAG213`
                  : ` · ${capacity.headroom} spare`}
              </Text>
            </View>
          )}

          {FIELDS.map((field) => (
            <Field
              key={field.key}
              spec={field}
              value={profile[field.key]}
              onChange={(value) => setField(field.key, value)}
            />
          ))}

          {/* Two taps rather than a system dialog: a modal alert blocks the JS
              thread, and this screen has nothing destructive enough to warrant
              interrupting the app for. */}
          <TouchableOpacity
            accessibilityRole="button"
            disabled={empty}
            onPress={() => {
              if (confirmingReset) {
                reset();
                setConfirmingReset(false);
              } else {
                setConfirmingReset(true);
              }
            }}
            className={`${styles.reset} ${empty ? 'opacity-40' : ''}`}>
            <Text className={styles.resetText}>
              {confirmingReset ? 'Tap again to clear the card' : 'Clear card'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Container>
  );
}

function Field({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View className="gap-2">
      <Text className={styles.label}>{spec.label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={spec.placeholder}
        placeholderTextColor="#a1a1aa"
        keyboardType={spec.keyboardType}
        autoCapitalize={spec.autoCapitalize}
        autoCorrect={spec.autoCapitalize !== 'none'}
        multiline={spec.multiline}
        accessibilityLabel={spec.label}
        className={`${styles.input} ${spec.multiline ? 'h-24' : ''}`}
      />
    </View>
  );
}

const styles = {
  centre: 'flex-1 items-center justify-center p-8',
  muted: 'text-sm text-neutral-500 dark:text-neutral-400',
  title: 'text-3xl font-bold text-neutral-900 dark:text-neutral-50',
  subtitle: 'text-base text-neutral-500 dark:text-neutral-400',
  label: 'text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500',
  input:
    'rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-4 py-3 text-base text-neutral-900 dark:text-neutral-100',
  sizeOk:
    'rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-4 py-3',
  sizeOkText: 'text-xs text-neutral-500 dark:text-neutral-400',
  sizeWarn:
    'rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3',
  sizeWarnText: 'text-xs text-amber-900 dark:text-amber-300',
  reset: 'rounded-2xl border border-red-200 dark:border-red-900 px-4 py-3 items-center',
  resetText: 'text-sm font-medium text-red-700 dark:text-red-400',
};
