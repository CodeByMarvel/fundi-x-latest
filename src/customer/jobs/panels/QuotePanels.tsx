import { Alert, StyleSheet, Text, View } from 'react-native';
import { jobRepository } from '../../../data/backend';
import { useAdditionalQuotes, useQuote } from '../../../data/useJob';
import { Job } from '../../../domain/jobs/types';
import { formatKes } from '../../../domain/money';
import { sumItems } from '../../../domain/quotes/quotes';
import { Quote } from '../../../domain/quotes/types';
import { Card, textStyles } from '../../../shared/components/Card';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { QuoteItemsList } from '../../../shared/components/QuoteItemsList';
import { StatusPill } from '../../../shared/components/StatusPill';
import { useAsyncAction } from '../../../shared/hooks/useAsyncAction';
import { colors } from '../../../shared/theme/colors';

/** A repair estimate waiting for the customer's decision. */
export function QuoteReviewPanel({ job }: { job: Job }) {
  const quote = useQuote(job.baseQuoteId);
  const { pending, run } = useAsyncAction<'approve' | 'reject'>();

  if (!quote || quote.status !== 'PENDING') {
    return null;
  }

  const confirmReject = () =>
    Alert.alert(
      'Decline this estimate?',
      "Your fundi won't do the repair and the job will end. You won't pay anything more: the call-out you paid covered the visit and inspection.",
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
      title="Repair estimate"
      aside={
        quote.version > 1 ? (
          <StatusPill label="Updated" tone="warning" />
        ) : undefined
      }
    >
      {quote.note && <Text style={textStyles.quote}>“{quote.note}”</Text>}
      <QuoteItemsList items={quote.items} />
      <Text style={styles.note}>
        You pay this after the work is done and you've checked it.
      </Text>
      <View style={styles.actions}>
        <PrimaryButton
          label="Approve & start repair"
          onPress={() =>
            run('approve', () => jobRepository.approveQuote(job.id, quote.id))
          }
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

/**
 * The work the customer has agreed to pay for: the main quote (fixed by
 * Fundi-X, or the approved repair estimate) plus any approved extras.
 */
export function AgreedWorkPanel({
  job,
  title = 'Agreed work',
}: {
  job: Job;
  title?: string;
}) {
  const base = useQuote(job.baseQuoteId);
  const extras = useAdditionalQuotes(job.id).filter(
    q => q.status === 'APPROVED',
  );
  if (base?.status !== 'APPROVED') {
    return null;
  }
  const fixed = base.issuedBy === 'FUNDI_X';
  const items = [base, ...extras].flatMap(q => q.items);

  return (
    <Card
      title={title}
      aside={
        fixed ? <StatusPill label="Fixed price" tone="success" /> : undefined
      }
    >
      {fixed && base.note && (
        <Text style={textStyles.primary}>{base.note}</Text>
      )}
      <QuoteItemsList items={items} totalLabel="Agreed total" />
      {fixed && job.status !== 'COMPLETED' && (
        <Text style={styles.note}>
          Set by Fundi-X, so your fundi can't change it. You pay it after the
          work is done. Any extra work needs your approval first.
        </Text>
      )}
    </Card>
  );
}

/**
 * Extra work the fundi found on site. Pending ones need an answer; the base
 * work carries on either way.
 */
export function AdditionalQuotesPanel({ job }: { job: Job }) {
  const quotes = useAdditionalQuotes(job.id);
  const pendingQuotes = quotes.filter(q => q.status === 'PENDING');
  const declined = quotes.filter(q => q.status === 'REJECTED');

  if (pendingQuotes.length === 0 && declined.length === 0) {
    return null;
  }
  return (
    <>
      {pendingQuotes.map(q => (
        <PendingAdditionalQuote key={q.id} job={job} quote={q} />
      ))}
      {declined.length > 0 && (
        <Card title="Extra work you declined">
          {declined.map(q => (
            <View key={q.id} style={styles.declinedRow}>
              <Text style={[textStyles.secondary, styles.grow]}>
                {q.reason}
              </Text>
              <Text style={textStyles.secondary}>
                {formatKes(sumItems(q.items))}
              </Text>
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

function PendingAdditionalQuote({ job, quote }: { job: Job; quote: Quote }) {
  const { pending, run } = useAsyncAction<'approve' | 'reject'>();

  return (
    <Card
      title="Extra work found"
      aside={<StatusPill label="Needs your answer" tone="warning" />}
    >
      <Text style={textStyles.primary}>{quote.reason}</Text>
      <QuoteItemsList items={quote.items} totalLabel="Extra cost" />
      <Text style={styles.note}>
        Your agreed work carries on either way. If you decline, this extra work
        simply won't be done.
      </Text>
      <View style={styles.actions}>
        <PrimaryButton
          label="Approve extra work"
          onPress={() =>
            run('approve', () => jobRepository.approveQuote(job.id, quote.id))
          }
          loading={pending === 'approve'}
          disabled={pending !== null}
        />
        <PrimaryButton
          variant="outline"
          label="No thanks"
          onPress={() =>
            run('reject', () => jobRepository.rejectQuote(job.id, quote.id))
          }
          loading={pending === 'reject'}
          disabled={pending !== null}
        />
      </View>
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
  declinedRow: {
    flexDirection: 'row',
    gap: 12,
  },
  grow: {
    flex: 1,
  },
});
