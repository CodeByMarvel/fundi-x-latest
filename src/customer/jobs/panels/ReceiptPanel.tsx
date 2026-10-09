import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { jobRepository } from '../../../data/backend';
import { useJobLedger, useProvider } from '../../../data/useJob';
import { Job } from '../../../domain/jobs/types';
import { formatKes } from '../../../domain/money';
import { Card, textStyles } from '../../../shared/components/Card';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { StarRating } from '../../../shared/components/StarRating';
import { StatusPill } from '../../../shared/components/StatusPill';
import { TextField } from '../../../shared/components/TextField';
import { formatDateTime } from '../../../shared/format';
import { useAsyncAction } from '../../../shared/hooks/useAsyncAction';
import { colors } from '../../../shared/theme/colors';

/** Proof of payment: every charge, and every M-Pesa payment against it. */
export function ReceiptPanel({ job }: { job: Job }) {
  const ledger = useJobLedger(job.id);
  const provider = useProvider(job.providerId);
  if (ledger.payments.length === 0) {
    return null;
  }

  return (
    <Card title="Receipt">
      {ledger.charges.map(c => (
        <Row key={c.id} label={c.description} value={formatKes(c.amount)} />
      ))}
      <View style={styles.divider} />
      {ledger.payments.map(p => (
        <View key={p.id}>
          <Row
            label={
              p.purpose === 'CALL_OUT' ? 'Paid: call-out' : 'Paid: service'
            }
            value={formatKes(p.amount)}
          />
          <Text style={styles.meta}>
            M-Pesa {p.receiptNumber} · {formatDateTime(p.updatedAt)}
          </Text>
        </View>
      ))}
      <Row label="Total paid" value={formatKes(ledger.totalPaid)} strong />
      {provider && <Text style={styles.meta}>Service by {provider.name}</Text>}
    </Card>
  );
}

/**
 * For a cancelled job: what happened to the money already paid. Refunds
 * and payouts are separate records, so this reads them rather than guessing.
 */
export function MoneyOutcomePanel({ job }: { job: Job }) {
  const ledger = useJobLedger(job.id);
  if (ledger.payments.length === 0) {
    return null;
  }

  return (
    <Card title="Your money">
      {ledger.refunds.map(r => (
        <View key={r.id} style={styles.row}>
          <Text style={[textStyles.primary, styles.grow]}>
            Refund of {formatKes(r.amount)} to your M-Pesa
          </Text>
          <StatusPill
            label={r.status === 'SUCCESS' ? 'Sent' : 'Processing'}
            tone={r.status === 'SUCCESS' ? 'success' : 'warning'}
          />
        </View>
      ))}
      {ledger.release && (
        <Text style={textStyles.secondary}>
          Your {formatKes(ledger.release.gross)} call-out paid for your fundi's
          trip
          {job.cancellation?.reason === 'quote_declined' && ' and inspection'},
          so it isn't refundable.
        </Text>
      )}
      {ledger.refunds.length === 0 && !ledger.release && (
        <Text style={textStyles.secondary}>
          Your {formatKes(ledger.totalPaid)} is being held while Fundi-X support
          decides on your case.
        </Text>
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
      <Text style={[styles.label, strong && styles.strongLabel]}>{label}</Text>
      <Text style={[styles.value, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  grow: {
    flex: 1,
  },
  label: {
    flex: 1,
    fontSize: 14,
    color: colors.textGrey,
  },
  strongLabel: {
    fontWeight: '700',
    color: colors.textDark,
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
  meta: {
    fontSize: 12,
    color: colors.textLight,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
  },
});
