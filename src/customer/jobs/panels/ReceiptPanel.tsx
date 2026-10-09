import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { jobRepository } from '../../../data/backend';
import { useProvider, useQuote } from '../../../data/useJob';
import { Job } from '../../../domain/jobs/types';
import { formatKes } from '../../../domain/money';
import { Card, textStyles } from '../../../shared/components/Card';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { QuoteItemsList } from '../../../shared/components/QuoteItemsList';
import { StarRating } from '../../../shared/components/StarRating';
import { TextField } from '../../../shared/components/TextField';
import { useAsyncAction } from '../../../shared/hooks/useAsyncAction';
import { colors } from '../../../shared/theme/colors';
import { formatDateTime } from '../../../shared/format';

/** Proof of payment: what was paid, to whom, and the M-Pesa code. */
export function ReceiptPanel({ job }: { job: Job }) {
  const quote = useQuote(job.quoteId);
  const provider = useProvider(job.providerId);
  if (!job.payment) {
    return null;
  }
  const items =
    job.chargeType === 'INSPECTION_ONLY'
      ? quote?.items.filter(
          i => i.kind === 'CALL_OUT' || i.kind === 'INSPECTION',
        )
      : quote?.items;

  return (
    <Card title="Receipt">
      <Row label="Paid" value={formatKes(job.payment.amount)} strong />
      <Row label="M-Pesa code" value={job.payment.receiptNumber} />
      <Row label="Date" value={formatDateTime(job.payment.paidAt)} />
      {provider && <Row label="Fundi" value={provider.name} />}
      {items && (
        <View style={styles.items}>
          <QuoteItemsList items={items} totalLabel="Total paid" />
        </View>
      )}
    </Card>
  );
}

/** Asks for a rating once the job is complete; thanks them afterwards. */
export function RatingPanel({ job }: { job: Job }) {
  const provider = useProvider(job.providerId);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const { pending, run } = useAsyncAction<'rate'>();

  if (job.rating) {
    return (
      <Card title="Your rating">
        <StarRating value={job.rating.stars} />
        {!!job.rating.comment && (
          <Text style={textStyles.quote}>“{job.rating.comment}”</Text>
        )}
        <Text style={textStyles.secondary}>Thanks for your feedback!</Text>
      </Card>
    );
  }

  return (
    <Card title={`Rate ${provider?.name ?? 'your fundi'}`}>
      <StarRating value={stars} onChange={setStars} size={34} />
      <TextField
        multiline
        value={comment}
        onChangeText={setComment}
        placeholder="Anything to add? (optional)"
      />
      <PrimaryButton
        label="Submit rating"
        onPress={() =>
          run('rate', () => jobRepository.submitRating(job.id, stars, comment))
        }
        disabled={stars === 0}
        loading={pending === 'rate'}
      />
    </Card>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  label: {
    fontSize: 14,
    color: colors.textGrey,
  },
  value: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textDark,
  },
  strong: {
    fontSize: 20,
    fontWeight: '800',
  },
  items: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
