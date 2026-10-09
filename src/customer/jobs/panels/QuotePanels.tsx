import { Alert, StyleSheet, Text, View } from 'react-native';
import { jobRepository } from '../../../data/backend';
import { useQuote } from '../../../data/useJob';
import { Job } from '../../../domain/jobs/types';
import { formatKes } from '../../../domain/money';
import { feeTotal } from '../../../domain/quotes/quotes';
import { Card, textStyles } from '../../../shared/components/Card';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { QuoteItemsList } from '../../../shared/components/QuoteItemsList';
import { StatusPill } from '../../../shared/components/StatusPill';
import { useAsyncAction } from '../../../shared/hooks/useAsyncAction';
import { colors } from '../../../shared/theme/colors';

/** The estimate waiting for the customer's decision. */
export function QuoteReviewPanel({ job }: { job: Job }) {
  const quote = useQuote(job.quoteId);
  const { pending, run } = useAsyncAction<'approve' | 'reject'>();

  if (!quote || quote.status !== 'PENDING') {
    return null;
  }
  const fee = feeTotal(quote.items);

  const approve = () =>
    run('approve', () => jobRepository.approveQuote(job.id, quote.id));

  const confirmReject = () =>
    Alert.alert(
      'Decline this estimate?',
      fee > 0
        ? `Your fundi won't do the work. You'll pay ${formatKes(
            fee,
          )} for the call-out and inspection.`
        : "Your fundi won't do the work and there's nothing to pay.",
      [
        { text: 'Go back', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: () =>
            run('reject', () => jobRepository.rejectQuote(job.id, quote.id)),
        },
      ],
    );

  return (
    <Card
      title="Service estimate"
      aside={quote.version > 1 && <StatusPill label="Updated" tone="warning" />}
    >
      {quote.note && <Text style={textStyles.quote}>“{quote.note}”</Text>}
      <QuoteItemsList items={quote.items} />
      {fee > 0 && (
        <Text style={styles.note}>
          If you decline, you only pay the {formatKes(fee)} call-out and
          inspection fee.
        </Text>
      )}
      <View style={styles.actions}>
        <PrimaryButton
          label="Approve & start work"
          onPress={approve}
          loading={pending === 'approve'}
          disabled={pending !== null}
        />
        <PrimaryButton
          variant="outline"
          label="Decline estimate"
          onPress={confirmReject}
          loading={pending === 'reject'}
          disabled={pending !== null}
        />
      </View>
    </Card>
  );
}

/** The approved work, shown while it's being done and when confirming it. */
export function ApprovedWorkPanel({
  job,
  title = 'Work being done',
}: {
  job: Job;
  title?: string;
}) {
  const quote = useQuote(job.quoteId);
  if (quote?.status !== 'APPROVED') {
    return null;
  }
  return (
    <Card title={title}>
      <QuoteItemsList items={quote.items} totalLabel="Agreed total" />
    </Card>
  );
}

const styles = StyleSheet.create({
  note: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textGrey,
  },
  actions: {
    gap: 8,
    marginTop: 4,
  },
});
