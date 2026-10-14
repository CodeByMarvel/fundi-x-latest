import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { TextField } from '../../shared/components/TextField';
import { colors } from '../../shared/theme/colors';
import { ServerError } from '../api';
import { useAuth } from '../AuthContext';
import { AuthLayout, ErrorText } from './AuthLayout';

/** Asked once after sign-in: M-Pesa and the mechanic need a number. */
export function PhoneScreen() {
  const { state, setPhone, signOut } = useAuth();
  const isProvider =
    state.status === 'signedIn' && state.account.role === 'provider';
  const [phone, setPhoneText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setPhone(phone);
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
      title="Your M-Pesa number"
      subtitle={
        isProvider
          ? 'Your earnings are paid to this number, and customers can reach you on it during a job.'
          : 'You pay from this number, and your mechanic can reach you on it during a job.'
      }
      footer={
        <PrimaryButton
          label="Use a different account"
          variant="ghost"
          onPress={signOut}
        />
      }
    >
      <TextField
        label="Phone number"
        placeholder="0712 345 678"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        value={phone}
        onChangeText={setPhoneText}
        maxLength={16}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label="Continue"
        onPress={save}
        loading={busy}
        disabled={phone.trim().length < 9}
      />
      <Text style={styles.note}>
        Your first M-Pesa payment confirms the number is yours.
      </Text>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  note: {
    fontSize: 13,
    color: colors.textLight,
    textAlign: 'center',
  },
});
