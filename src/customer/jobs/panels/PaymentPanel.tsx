import { CircleAlert, CircleCheck } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { billingService } from '../../../data/backend';
import { useJobLedger } from '../../../data/useJob';
import { formatPhone, MoneyPurpose } from '../../../domain/billing/types';
import { Job } from '../../../domain/jobs/types';
import { formatKes } from '../../../domain/money';
import { Card } from '../../../shared/components/Card';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { TextField } from '../../../shared/components/TextField';
import { useAsyncAction } from '../../../shared/hooks/useAsyncAction';
import { colors } from '../../../shared/theme/colors';
import { customer } from '../../data/mockHome';
import { paymentFailureText } from '../jobPresentation';
import { SimulatedPhonePrompt } from './SimulatedPhonePrompt';

/**
 * Paying with M-Pesa: the call-out before dispatch, or the rest at the end.
 * The panel follows the latest attempt for the current purpose:
 * sending → waiting for PIN → processing → success, or failed with a retry.
 * When it succeeds, the backend moves the job on and this panel goes away.
 */
export function PaymentPanel({ job }: { job: Job }) {
  const ledger = useJobLedger(job.id);
  const [phone, setPhone] = useState(customer.mpesaPhone);
  const { pending, run } = useAsyncAction<'pay'>();

  const purpose: MoneyPurpose =
    job.status === 'CALL_OUT_PAYMENT_PENDING' ? 'CALL_OUT' : 'SERVICE';
  const due = purpose === 'CALL_OUT' ? ledger.callOutDue : ledger.serviceDue;
  const attempt =
    ledger.latestPayment?.purpose === purpose
      ? ledger.latestPayment
      : undefined;
  const inFlight =
    attempt?.status === 'PENDING' || attempt?.status === 'PROCESSING';

  return (
    <Card title={purpose === 'CALL_OUT' ? 'Call-out fee' : 'Payment'}>
      {purpose === 'CALL_OUT' ? (
        <CallOutSummary amount={due} />
      ) : (
        <ServiceSummary job={job} />
      )}

      {pending === 'pay' && (
        <Status spinner text={`Sending M-Pesa request to ${phone}…`} />
      )}
      {attempt?.status === 'PENDING' && (
        <>
          <Status
            spinner
            text={`Check your phone (${formatPhone(
              attempt.phone,
            )}) and enter your M-Pesa PIN to pay.`}
          />
          <SimulatedPhonePrompt payment={attempt} />
        </>
      )}
      {attempt?.status === 'PROCESSING' && (
        <Status spinner text="Confirming your payment with M-Pesa…" />
      )}
      {attempt?.status === 'SUCCESS' && (
        <Status icon="success" text="Payment received. Finishing up…" />
      )}
      {attempt?.status === 'FAILED' && !pending && (
        <Status icon="error" text={paymentFailureText(attempt.failureReason)} />
      )}

      {!inFlight && attempt?.status !== 'SUCCESS' && pending !== 'pay' && (
        <>
          <TextField
            label="M-Pesa number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          <PrimaryButton
            label={
              attempt?.status === 'FAILED'
                ? 'Try again'
                : `Pay ${formatKes(due)} with M-Pesa`
            }
            onPress={() =>
              run('pay', () => billingService.initiatePayment(job.id, phone))
            }
          />
        </>
      )}
    </Card>
  );
}

function CallOutSummary({ amount }: { amount: number }) {
  return (
    <>
      <Row
        label="Call-out (transport & inspection)"
        value={formatKes(amount)}
        strong
      />
      <Text style={styles.hint}>
        Held safely by Fundi-X until your job ends. Refunded in full if no fundi
        is found, or if you cancel before your fundi sets off.
      </Text>
    </>
  );
}

/** Model B: show what's been paid and what's left, from the ledger. */
function ServiceSummary({ job }: { job: Job }) {
  const ledger = useJobLedger(job.id);
  const callOutPaid = ledger.payments
    .filter(p => p.purpose === 'CALL_OUT')
    .reduce((s, p) => s + p.amount, 0);

  return (
    <>
      {ledger.charges
        .filter(c => c.purpose === 'SERVICE')
        .map(c => (
          <Row key={c.id} label={c.description} value={formatKes(c.amount)} />
        ))}
      {callOutPaid > 0 && (
        <Row
          label="Call-out (already paid ✓)"
          value={formatKes(callOutPaid)}
          muted
        />
      )}
      <View style={styles.divider} />
      <Row label="Still to pay" value={formatKes(ledger.serviceDue)} strong />
    </>
  );
}

function Row({
  label,
  value,
  strong = false,
  muted = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, strong && styles.strongLabel]}>{label}</Text>
      <Text
        style={[
          styles.value,
          strong && styles.strongValue,
          muted && styles.muted,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function Status({
  text,
  spinner = false,
  icon,
}: {
  text: string;
  spinner?: boolean;
  icon?: 'success' | 'error';
}) {
  return (
    <View style={styles.status}>
      {spinner && <ActivityIndicator color={colors.primary} />}
      {icon === 'success' && <CircleCheck color={colors.success} size={20} />}
      {icon === 'error' && <CircleAlert color={colors.error} size={20} />}
      <Text style={[styles.statusText, icon === 'error' && styles.errorText]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  label: {
    flex: 1,
    fontSize: 15,
    color: colors.textDark,
  },
  strongLabel: {
    fontWeight: '700',
  },
  value: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textDark,
  },
  strongValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  muted: {
    color: colors.textGrey,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textGrey,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.background,
  },
  statusText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textDark,
  },
  errorText: {
    color: colors.error,
  },
});
