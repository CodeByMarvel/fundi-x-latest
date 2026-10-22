import { CircleAlert, CircleCheck } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { billingService } from '../../../data/backend';
import { useJobLedger } from '../../../data/useJob';
import { formatPhone, MoneyPurpose } from '../../../domain/billing/types';
import { Job } from '../../../domain/jobs/types';
import { Quote } from '../../../domain/quotes/types';
import { formatKes } from '../../../domain/money';
import { Card } from '../../../shared/components/Card';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { TextField } from '../../../shared/components/TextField';
import { useAsyncAction } from '../../../shared/hooks/useAsyncAction';
import { colors } from '../../../shared/theme/colors';
import { useCustomerProfile } from '../../data/currentCustomer';
import { paymentFailureText } from '../jobPresentation';
import { SimulatedPhonePrompt } from './SimulatedPhonePrompt';

/**
 * Paying into escrow with M-Pesa: the call-out before dispatch, the agreed
 * price before work starts, or (with `quote`) an extra-work quote, which is
 * approved by paying for it.
 *
 * The panel follows the latest attempt for that money:
 * sending → waiting for PIN → processing → success, or failed with a retry.
 * When it succeeds, the backend moves the job on and this panel goes away.
 */
export function PaymentPanel({ job, quote }: { job: Job; quote?: Quote }) {
  const ledger = useJobLedger(job.id);
  const { mpesaPhone } = useCustomerProfile();
  const [phone, setPhone] = useState(mpesaPhone);
  const { pending, run } = useAsyncAction<'pay'>();

  const purpose: MoneyPurpose =
    job.status === 'CALL_OUT_PAYMENT_PENDING' ? 'CALL_OUT' : 'SERVICE';
  const due = quote
    ? quote.total
    : purpose === 'CALL_OUT'
    ? ledger.callOutDue
    : ledger.serviceDue;
  const attempt = ledger.attempts.find(p =>
    quote ? p.quoteId === quote.id : p.purpose === purpose && !p.quoteId,
  );
  const inFlight =
    attempt?.status === 'PENDING' || attempt?.status === 'PROCESSING';

  const content = (
    <>
      {quote ? null : purpose === 'CALL_OUT' ? (
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
              run('pay', () =>
                billingService.initiatePayment(job.id, phone, {
                  quoteId: quote?.id,
                }),
              )
            }
          />
        </>
      )}
    </>
  );

  // Inside an extra-work card there's no need for a second card.
  return quote ? (
    content
  ) : (
    <Card title={purpose === 'CALL_OUT' ? 'Call-out fee' : 'Pay to start'}>
      {content}
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
        .filter(c => c.purpose === 'SERVICE' || c.purpose === 'PARTS')
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
      <Row label="To pay now" value={formatKes(ledger.serviceDue)} strong />
      <Text style={styles.hint}>
        {ledger.charges.some(c => c.purpose === 'PARTS')
          ? 'The parts money goes to your fundi now, to buy the parts. The rest is held safely by Fundi-X until you confirm the work is done, and you can report a problem before then.'
          : 'Held safely by Fundi-X. Your fundi only receives it once you confirm the work is done, and you can report a problem before then.'}
      </Text>
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
