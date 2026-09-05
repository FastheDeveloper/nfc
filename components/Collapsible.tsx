import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

interface CollapsibleProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

/**
 * A disclosure section.
 *
 * Used for the two places Phase 2 wants to keep evidence available without
 * putting it in front of a user: the raw JSON dump on Tag Info, and the
 * developer detail on an error card. Both matter to the article and to
 * debugging; neither should be the first thing anyone reads.
 *
 * No animation on purpose. `LayoutAnimation` needs per-platform setup and
 * Reanimated is a bigger hammer than a caret needs — and an instant toggle is
 * one less thing that can misbehave while we are photographing screens for the
 * article.
 */
export const Collapsible = ({ title, children, defaultOpen = false }: CollapsibleProps) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View className={styles.wrapper}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        onPress={() => setOpen((wasOpen) => !wasOpen)}
        className={styles.header}>
        <Text className={styles.caret}>{open ? '▾' : '▸'}</Text>
        <Text className={styles.title}>{title}</Text>
      </TouchableOpacity>

      {open && <View className={styles.body}>{children}</View>}
    </View>
  );
};

const styles = {
  wrapper: 'gap-2',
  header: 'flex-row items-center gap-2 py-1',
  caret: 'text-xs text-neutral-400 dark:text-neutral-500 w-3',
  title: 'text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500',
  body: 'gap-2 pl-5',
};
