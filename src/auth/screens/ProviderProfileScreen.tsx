import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { TextField } from '../../shared/components/TextField';
import { colors } from '../../shared/theme/colors';
import { ServerError } from '../api';
import { useAuth } from '../AuthContext';
import { AuthLayout, ErrorText } from './AuthLayout';

const TYPES = [
  { type: 'mechanic', label: 'Mobile mechanic' },
  { type: 'garage', label: 'Garage' },
] as const;

/** A new mechanic's profile. Fundi-X verifies it before any job is offered. */
export function ProviderProfileScreen() {
  const { setProviderProfile, signOut } = useAuth();
  const [type, setType] = useState<'mechanic' | 'garage'>('mechanic');
  const [businessName, setBusinessName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    specialty.trim().length >= 2 &&
    (type === 'mechanic' || businessName.trim().length >= 2);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setProviderProfile({
        type,
        specialty: specialty.trim(),
        ...(type === 'garage' && { businessName: businessName.trim() }),
      });
    } catch (err) {
      setError(
        err instanceof ServerError
          ? err.message
          : 'Could not save. Please try again.',
      );
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Tell us about your work"
      subtitle="Fundi-X checks every mechanic before sending jobs. We'll contact you to verify your details."
      footer={
        <PrimaryButton
          label="Use a different account"
          variant="ghost"
          onPress={signOut}
        />
      }
    >
      <View style={styles.types}>
        {TYPES.map(t => (
          <Pressable
            key={t.type}
            onPress={() => setType(t.type)}
            style={[styles.type, type === t.type && styles.typeOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: type === t.type }}
          >
            <Text
              style={[styles.typeLabel, type === t.type && styles.typeLabelOn]}
            >
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {type === 'garage' && (
        <TextField
          label="Garage name"
          placeholder="Kilimani Auto Garage"
          value={businessName}
          onChangeText={setBusinessName}
          maxLength={100}
        />
      )}
      <TextField
        label="What you're best at"
        placeholder="Brakes and suspension"
        value={specialty}
        onChangeText={setSpecialty}
        maxLength={100}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label="Submit for verification"
        onPress={save}
        loading={busy}
        disabled={!ready}
      />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  types: {
    flexDirection: 'row',
    gap: 10,
  },
  type: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  typeOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySurface,
  },
  typeLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textGrey,
  },
  typeLabelOn: {
    color: colors.primary,
  },
});
