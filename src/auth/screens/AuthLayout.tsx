import { ReactNode } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../shared/theme/colors';

/** The shared frame of the sign-in and setup screens. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { top, bottom } = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: top + 40, paddingBottom: bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Image
          source={require('../../../assets/brand/fundix-icon-192.png')}
          style={styles.logo}
          accessibilityIgnoresInvertColors
        />
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        <View style={styles.body}>{children}</View>
        {footer && <View style={styles.footer}>{footer}</View>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function ErrorText({ children }: { children: string | null }) {
  return children ? <Text style={styles.error}>{children}</Text> : null;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 18,
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textDark,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textGrey,
    marginTop: 8,
  },
  body: {
    marginTop: 28,
    gap: 14,
  },
  footer: {
    marginTop: 'auto',
    paddingTop: 24,
  },
  error: {
    color: colors.error,
    fontSize: 14,
    lineHeight: 20,
  },
});
