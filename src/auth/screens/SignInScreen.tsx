import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { colors } from '../../shared/theme/colors';
import { AccountRole } from '../api';
import { useAuth } from '../AuthContext';
import { AuthLayout, ErrorText } from './AuthLayout';

const CHOICES: { role: AccountRole; title: string; detail: string }[] = [
  {
    role: 'customer',
    title: 'I need a mechanic',
    detail: 'Book repairs and services for your car',
  },
  {
    role: 'provider',
    title: "I'm a mechanic or garage",
    detail: 'Get jobs near you and get paid through M-Pesa',
  },
];

export function SignInScreen() {
  const { signInWithGoogle, enterDemo } = useAuth();
  const [role, setRole] = useState<AccountRole>('customer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function google() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle(role);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome to Fundi-X"
      subtitle="Trusted mechanics, wherever your car is."
      footer={
        __DEV__ ? (
          <PrimaryButton
            label="Explore with demo data (development)"
            variant="ghost"
            onPress={enterDemo}
          />
        ) : undefined
      }
    >
      {CHOICES.map(c => (
        <Pressable
          key={c.role}
          onPress={() => setRole(c.role)}
          style={[styles.choice, role === c.role && styles.chosen]}
          accessibilityRole="radio"
          accessibilityState={{ selected: role === c.role }}
        >
          <View style={[styles.radio, role === c.role && styles.radioOn]} />
          <View style={styles.choiceText}>
            <Text style={styles.choiceTitle}>{c.title}</Text>
            <Text style={styles.choiceDetail}>{c.detail}</Text>
          </View>
        </Pressable>
      ))}
      <PrimaryButton
        label="Continue with Google"
        onPress={google}
        loading={busy}
      />
      <ErrorText>{error}</ErrorText>
      <Text style={styles.note}>
        We never see your Google password. Google only confirms who you are.
      </Text>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  chosen: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySurface,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.inactive,
  },
  radioOn: {
    borderColor: colors.primary,
    borderWidth: 6,
  },
  choiceText: {
    flex: 1,
  },
  choiceTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textDark,
  },
  choiceDetail: {
    fontSize: 14,
    color: colors.textGrey,
    marginTop: 2,
  },
  note: {
    fontSize: 13,
    color: colors.textLight,
    textAlign: 'center',
  },
});
