import { Smartphone } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { simulatedPhone } from '../../../data/backend';
import { formatKes } from '../../../domain/money';
import { Payment } from '../../../domain/payments/types';
import { colors } from '../../../shared/theme/colors';

/**
 * DEV ONLY. In production the M-Pesa prompt appears on the customer's phone,
 * outside our app. While payments are mocked, this box plays that phone so
 * every outcome can be tried. Remove it with the mock.
 */
export function SimulatedPhonePrompt({ payment }: { payment: Payment }) {
  const respond = simulatedPhone.respondToPaymentPrompt;

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <Smartphone color={colors.textGrey} size={14} />
        <Text style={styles.devLabel}>Simulated phone · dev only</Text>
      </View>
      <Text style={styles.prompt}>
        Do you want to pay {formatKes(payment.amount)} to FUNDI-X? Enter M-Pesa
        PIN.
      </Text>
      <View style={styles.buttons}>
        <PhoneButton
          label="Enter PIN & pay"
          strong
          onPress={() => respond(payment.id, 'pay')}
        />
        <PhoneButton
          label="Cancel"
          onPress={() => respond(payment.id, 'cancel')}
        />
        <PhoneButton
          label="Low balance"
          onPress={() => respond(payment.id, 'insufficient_funds')}
        />
      </View>
      <Text style={styles.hint}>
        Or do nothing: M-Pesa gives up after 60 seconds.
      </Text>
    </View>
  );
}

function PhoneButton({
  label,
  strong = false,
  onPress,
}: {
  label: string;
  strong?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.button, strong && styles.buttonStrong]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={[styles.buttonText, strong && styles.buttonTextStrong]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.inactive,
    backgroundColor: colors.background,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  devLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.textGrey,
  },
  prompt: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.textDark,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  buttonStrong: {
    borderColor: colors.success,
    backgroundColor: colors.success,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textDark,
  },
  buttonTextStrong: {
    color: colors.surface,
  },
  hint: {
    fontSize: 12,
    color: colors.textLight,
  },
});
