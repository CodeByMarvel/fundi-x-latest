import { CircleAlert, CircleCheck } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { paymentService } from '../../../data/backend';
import { useLatestPayment, useQuote } from '../../../data/useJob';
import { Job } from '../../../domain/jobs/types';
import { formatKes } from '../../../domain/money';
import { formatPhone } from '../../../domain/payments/types';
import { feeTotal } from '../../../domain/quotes/quotes';
import { Card } from '../../../shared/components/Card';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { QuoteItemsList } from '../../../shared/components/QuoteItemsList';
import { TextField } from '../../../shared/components/TextField';
import { useAsyncAction } from '../../../shared/hooks/useAsyncAction';
import { colors } from '../../../shared/theme/colors';
import { customer } from '../../data/mockHome';
import { paymentFailureText } from '../jobPresentation';
import { SimulatedPhonePrompt } from './SimulatedPhonePrompt';

/**
 * Paying with M-Pesa. The panel reflects the latest payment attempt:
 * sending → waiting for PIN → processing → success, or failed with a retry.
 * When it succeeds, the backend moves the job to PAID and this panel is
 * replaced by the receipt.
 */
export function PaymentPanel({ job }: { job: Job }) {
  const payment = useLatestPayment(job.id);
  const quote = useQuote(job.quoteId);
  const [phone, setPhone] = useState(customer.mpesaPhone);
  const { pending, run } = useAsyncAction<'pay'>();

  const inspectionOnly = job.chargeType === 'INSPECTION_ONLY';
  const items = inspectionOnly
    ? quote?.items.filter(i => i.kind === 'CALL_OUT' || i.kind === 'INSPECTION')
    : quote?.items;
  const inFlight =
    payment?.status === 'PENDING' || payment?.status === 'PROCESSING';

  const pay = () =>
    run('pay', () => paymentService.initiatePayment(job.id, phone));

  return (
    <Card title="Payment">
      <View style={styles.amountRow}>
        <Text style={styles.amountLabel}>Amount due</Text>
        <Text style={styles.amount}>{formatKes(job.amountDue ?? 0)}</Text>
      </View>
      {items && quote && (
        <QuoteItemsList
          items={items}
          totalLabel={inspectionOnly ? 'Call-out & inspection' : 'Total'}
        />
      )}
      {inspectionOnly && quote && (
        <Text style={styles.hint}>
          Estimate declined: {formatKes(quote.total - feeTotal(quote.items))} of
          work was not done and is not charged.
        </Text>
      )}

      {pending === 'pay' && (
        <Status spinner text={`Sending M-Pesa request to ${phone}…`} />
      )}

      {payment?.status === 'PENDING' && (
        <>
          <Status
            spinner
            text={`Check your phone (${formatPhone(
              payment.phone,
            )}) and enter your M-Pesa PIN to pay.`}
          />
          <SimulatedPhonePrompt payment={payment} />
        </>
      )}

      {payment?.status === 'PROCESSING' && (
        <Status spinner text="Confirming your payment with M-Pesa…" />
      )}

      {payment?.status === 'SUCCESS' && (
        <Status icon="success" text="Payment received. Finishing up…" />
      )}

      {payment?.status === 'FAILED' && !pending && (
        <Status icon="error" text={paymentFailureText(payment.failureReason)} />
      )}

      {!inFlight && payment?.status !== 'SUCCESS' && pending !== 'pay' && (
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
              payment?.status === 'FAILED'
                ? 'Try again'
                : `Pay ${formatKes(job.amountDue ?? 0)} with M-Pesa`
            }
            onPress={pay}
          />
        </>
      )}
    </Card>
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
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  amountLabel: {
    fontSize: 15,
    color: colors.textGrey,
  },
  amount: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textDark,
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
