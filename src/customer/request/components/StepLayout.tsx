import { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../../shared/theme/colors';

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Pinned to the bottom, e.g. a Continue button. */
  footer?: ReactNode;
};

/** Every step answers one question: a title, the answers, and a footer. */
export function StepLayout({ title, subtitle, children, footer }: Props) {
  const { bottom } = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        <View style={styles.body}>{children}</View>
      </ScrollView>
      {footer && (
        <View style={[styles.footer, { paddingBottom: bottom + 12 }]}>
          {footer}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textDark,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.textGrey,
    marginTop: 8,
  },
  body: {
    marginTop: 24,
    gap: 12,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 8,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
