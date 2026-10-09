import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Phone } from 'lucide-react-native';
import { useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { vehicleName } from '../../customer/data/mockVehicles';
import { getCategory } from '../../customer/request/data/categories';
import { jobRepository } from '../../data/backend';
import {
  useAdditionalQuotes,
  useJob,
  useJobLedger,
  useQuote,
} from '../../data/useJob';
import { formatRate } from '../../domain/billing/commission';
import { NO_SHOW_WAIT_MS } from '../../domain/jobs/rules';
import { canTransition } from '../../domain/jobs/transitions';
import { Job } from '../../domain/jobs/types';
import { formatKes } from '../../domain/money';
import { Quote, QuoteStatus } from '../../domain/quotes/types';
import { Avatar } from '../../shared/components/Avatar';
import { Card, Detail, textStyles } from '../../shared/components/Card';
import { MapPlaceholder } from '../../shared/components/MapPlaceholder';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { QuoteItemsList } from '../../shared/components/QuoteItemsList';
import { ReasonForm } from '../../shared/components/ReasonForm';
import { ScreenHeader } from '../../shared/components/ScreenHeader';
import { StarRating } from '../../shared/components/StarRating';
import { PillTone, StatusPill } from '../../shared/components/StatusPill';
import { useAsyncAction } from '../../shared/hooks/useAsyncAction';
import { useNow } from '../../shared/hooks/useNow';
import { colors } from '../../shared/theme/colors';
import { CURRENT_PROVIDER_ID, mockCustomerContact } from '../data/mockMechanic';
import type { MechanicStackParamList } from '../navigation/MechanicNavigator';
import {
  drivabilityView,
  providerJobView,
  symptomLabels,
  urgencyText,
} from './providerJobPresentation';

type Props = NativeStackScreenProps<MechanicStackParamList, 'MechanicJob'>;

type Action =
  | 'accept'
  | 'decline'
  | 'trip'
  | 'arrive'
  | 'start'
  | 'noShow'
  | 'revise'
  | 'complete'
  | 'withdraw';

/** A form that replaces the action buttons while it's open. */
type OpenForm = 'complete' | 'withdraw' | null;

const me = CURRENT_PROVIDER_ID;

/**
 * Everything a provider does on one job. Like the customer's tracking
 * screen, it only shows state; every button calls the backend, and the
 * screen updates when the backend announces the change.
 */
export function MechanicJobScreen({ navigation, route }: Props) {
  const { top, bottom } = useSafeAreaInsets();
  const job = useJob(route.params.jobId);
  const additional = useAdditionalQuotes(route.params.jobId);
  const ledger = useJobLedger(route.params.jobId);
  const { pending, run } = useAsyncAction<Action>();
  const [form, setForm] = useState<OpenForm>(null);
  const now = useNow();

  const isMine = job?.providerId === me;
  const offeredToMe = job?.status === 'OFFERED' && job.offeredProviderId === me;
  // A job that ended with a payout to me stays visible for the record.
  const paidToMe = ledger.release?.providerId === me;

  if (!job || (!isMine && !offeredToMe && !paidToMe)) {
    return (
      <View style={[styles.screen, { paddingTop: top }]}>
        <ScreenHeader title="Job" onBack={() => navigation.goBack()} />
        <View style={styles.gone}>
          <Text style={styles.title}>This job is no longer available</Text>
          <Text style={textStyles.secondary}>
            It may have been cancelled, or handed to another fundi.
          </Text>
          <PrimaryButton label="Back" onPress={() => navigation.goBack()} />
        </View>
      </View>
    );
  }

  const view = providerJobView(job);
  // The rulebook decides which buttons exist, not this screen.
  const canWithdraw = isMine && canTransition(job, 'SEARCHING', 'PROVIDER');
  const waitingOnExtra = additional.some(q => q.status === 'PENDING');
  const msUntilNoShow =
    job.status === 'ARRIVED'
      ? Date.parse(job.arrivedAt ?? job.updatedAt) + NO_SHOW_WAIT_MS - now
      : 0;

  const act = (name: Action, action: () => Promise<unknown>) =>
    run(name, action).then(ok => ok && setForm(null));

  const revise = () =>
    act('revise', async () => {
      await jobRepository.reviseQuote(job.id, me);
      navigation.navigate('QuoteBuilder', { jobId: job.id, mode: 'base' });
    });

  return (
    <View style={[styles.screen, { paddingTop: top }]}>
      <ScreenHeader title="Job" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <StatusPill label={view.title} tone={view.tone} />
          <Text style={styles.title}>{getCategory(job.categoryId)?.label}</Text>
          <Text style={textStyles.secondary}>{view.hint}</Text>
        </View>

        {(job.status === 'ACCEPTED' || job.status === 'EN_ROUTE') && (
          <MapPlaceholder
            address={job.location.address}
            caption={
              job.etaMinutes ? `About ${job.etaMinutes} min away` : undefined
            }
          />
        )}

        {isMine && <CustomerCard />}

        <ProblemCard job={job} />
        <BaseQuoteCard job={job} />
        {additional.map(q => (
          <AdditionalQuoteCard key={q.id} quote={q} />
        ))}

        {job.workSummary && (
          <Card title="Your work notes">
            <Text style={textStyles.quote}>“{job.workSummary}”</Text>
          </Card>
        )}
        {job.dispute && (
          <Card title="Customer's report">
            <Text style={textStyles.quote}>“{job.dispute.reason}”</Text>
            {job.dispute.resolution && (
              <Text style={textStyles.secondary}>
                Support: {job.dispute.resolution}
              </Text>
            )}
          </Card>
        )}
        <EarningsCard jobId={job.id} />
        {job.rating && (
          <Card title="Customer's rating">
            <StarRating value={job.rating.stars} />
            {!!job.rating.comment && (
              <Text style={textStyles.quote}>“{job.rating.comment}”</Text>
            )}
          </Card>
        )}

        {/* ---- Actions for the current status ---- */}

        {form === 'complete' && (
          <ReasonForm
            title="Finish the job"
            placeholder="What did you do? The customer sees this."
            submitLabel="Mark work complete"
            suggestions={['Work done as agreed', 'Replaced parts and tested']}
            loading={pending === 'complete'}
            onSubmit={text =>
              act('complete', () =>
                jobRepository.markWorkComplete(job.id, me, text),
              )
            }
            onBack={() => setForm(null)}
          />
        )}

        {form === 'withdraw' && (
          <ReasonForm
            title="Withdraw from this job"
            placeholder="Tell the customer why"
            submitLabel="Withdraw"
            suggestions={[
              'My vehicle broke down',
              'Emergency came up',
              "Can't reach the location",
            ]}
            loading={pending === 'withdraw'}
            onSubmit={text =>
              act('withdraw', async () => {
                await jobRepository.withdrawFromJob(job.id, me, text);
                navigation.goBack();
              })
            }
            onBack={() => setForm(null)}
          />
        )}

        {form === null && (
          <View style={styles.actions}>
            {offeredToMe && (
              <>
                <PrimaryButton
                  label="Accept job"
                  loading={pending === 'accept'}
                  onPress={() =>
                    act('accept', () => jobRepository.acceptOffer(job.id, me))
                  }
                />
                <PrimaryButton
                  variant="outline"
                  label="Decline"
                  loading={pending === 'decline'}
                  onPress={() =>
                    act('decline', async () => {
                      await jobRepository.declineOffer(job.id, me);
                      navigation.goBack();
                    })
                  }
                />
              </>
            )}
            {isMine && job.status === 'ACCEPTED' && (
              <PrimaryButton
                label="I'm on my way"
                loading={pending === 'trip'}
                onPress={() =>
                  act('trip', () => jobRepository.startTrip(job.id, me))
                }
              />
            )}
            {isMine && job.status === 'EN_ROUTE' && (
              <PrimaryButton
                label="I've arrived"
                loading={pending === 'arrive'}
                onPress={() =>
                  act('arrive', () => jobRepository.markArrived(job.id, me))
                }
              />
            )}
            {isMine && job.status === 'ARRIVED' && (
              <>
                <PrimaryButton
                  label={
                    job.pricingMode === 'FIXED'
                      ? 'Start service'
                      : 'Start inspection'
                  }
                  loading={pending === 'start'}
                  onPress={() =>
                    act('start', () =>
                      job.pricingMode === 'FIXED'
                        ? jobRepository.startService(job.id, me)
                        : jobRepository.startInspection(job.id, me),
                    )
                  }
                />
                <PrimaryButton
                  variant="outline"
                  label={
                    msUntilNoShow > 0
                      ? `Customer not here? (${formatWait(msUntilNoShow)})`
                      : 'Customer not here'
                  }
                  loading={pending === 'noShow'}
                  disabled={msUntilNoShow > 0}
                  onPress={() =>
                    act('noShow', () =>
                      jobRepository.reportCustomerNoShow(job.id, me),
                    )
                  }
                />
              </>
            )}
            {isMine && job.status === 'DIAGNOSING' && (
              <PrimaryButton
                label={job.baseQuoteId ? 'Send updated quote' : 'Create quote'}
                onPress={() =>
                  navigation.navigate('QuoteBuilder', {
                    jobId: job.id,
                    mode: 'base',
                  })
                }
              />
            )}
            {isMine && job.status === 'QUOTE_SENT' && (
              <PrimaryButton
                variant="outline"
                label="Change the quote"
                loading={pending === 'revise'}
                onPress={revise}
              />
            )}
            {isMine && job.status === 'IN_PROGRESS' && (
              <>
                {waitingOnExtra && (
                  <Text style={styles.waiting}>
                    Waiting for the customer to answer your extra quote. Carry
                    on with the agreed work meanwhile.
                  </Text>
                )}
                <PrimaryButton
                  label="Mark work complete"
                  disabled={waitingOnExtra}
                  onPress={() => setForm('complete')}
                />
                <PrimaryButton
                  variant="outline"
                  label="Found extra work? Quote it"
                  onPress={() =>
                    navigation.navigate('QuoteBuilder', {
                      jobId: job.id,
                      mode: 'additional',
                    })
                  }
                />
              </>
            )}
            {canWithdraw && (
              <PrimaryButton
                variant="ghost"
                label="Withdraw from job"
                onPress={() => setForm('withdraw')}
              />
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** "14:32" style countdown. */
function formatWait(ms: number) {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function CustomerCard() {
  return (
    <Card title="Customer">
      <View style={styles.row}>
        <Avatar name={mockCustomerContact.name} size={44} />
        <Text style={[textStyles.primary, styles.grow]}>
          {mockCustomerContact.name}
        </Text>
        <Pressable
          style={styles.call}
          onPress={() => Linking.openURL(`tel:+${mockCustomerContact.phone}`)}
          accessibilityLabel="Call customer"
        >
          <Phone color={colors.primary} size={20} />
        </Pressable>
      </View>
    </Card>
  );
}

function ProblemCard({ job }: { job: Job }) {
  const symptoms = symptomLabels(job);
  const drivability = drivabilityView(job.drivability);

  return (
    <Card title="The job">
      <Detail label="Vehicle">
        <Text style={textStyles.primary}>{vehicleName(job.vehicle)}</Text>
        <Text style={textStyles.secondary}>{job.vehicle.registration}</Text>
      </Detail>
      {symptoms.length > 0 && (
        <Detail label="Symptoms">
          <Text style={textStyles.primary}>{symptoms.join(', ')}</Text>
        </Detail>
      )}
      {!!job.description && (
        <Detail label="Customer says">
          <Text style={textStyles.quote}>“{job.description}”</Text>
        </Detail>
      )}
      <Detail label="Condition">
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: drivability.color }]} />
          <Text style={textStyles.primary}>{drivability.label}</Text>
        </View>
      </Detail>
      <Detail label="Where & when">
        <Text style={textStyles.primary}>{job.location.address}</Text>
        <Text style={textStyles.secondary}>
          {urgencyText(job.urgency, job)}
        </Text>
      </Detail>
    </Card>
  );
}

const QUOTE_STATUS: Record<QuoteStatus, { label: string; tone: PillTone }> = {
  PENDING: { label: 'Awaiting approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Declined', tone: 'stopped' },
  SUPERSEDED: { label: 'Being revised', tone: 'stopped' },
};

function BaseQuoteCard({ job }: { job: Job }) {
  const quote = useQuote(job.baseQuoteId);
  if (!quote) {
    return null;
  }
  const fixed = quote.issuedBy === 'FUNDI_X';
  const status = QUOTE_STATUS[quote.status];

  return (
    <Card
      title={
        fixed
          ? 'Agreed service'
          : quote.version > 1
          ? `Your quote (v${quote.version})`
          : 'Your quote'
      }
      aside={
        fixed ? (
          <StatusPill label="Fixed by Fundi-X" tone="success" />
        ) : (
          <StatusPill label={status.label} tone={status.tone} />
        )
      }
    >
      {quote.note && (
        <Text style={fixed ? textStyles.primary : textStyles.quote}>
          {fixed ? quote.note : `“${quote.note}”`}
        </Text>
      )}
      <QuoteItemsList items={quote.items} />
      {fixed && (
        <Text style={textStyles.secondary}>
          The customer agreed this price when booking. If something else is
          needed, quote it as extra work.
        </Text>
      )}
    </Card>
  );
}

function AdditionalQuoteCard({ quote }: { quote: Quote }) {
  const status = QUOTE_STATUS[quote.status];
  return (
    <Card
      title="Extra work"
      aside={<StatusPill label={status.label} tone={status.tone} />}
    >
      <Text style={textStyles.primary}>{quote.reason}</Text>
      <QuoteItemsList items={quote.items} totalLabel="Extra cost" />
    </Card>
  );
}

/** The payout recorded when the job ended, line by line. */
function EarningsCard({ jobId }: { jobId: string }) {
  const { release } = useJobLedger(jobId);
  if (!release) {
    return null;
  }

  return (
    <Card title="Your earnings">
      {release.lines.map(line => (
        <Line
          key={line.paymentId}
          label={line.purpose === 'CALL_OUT' ? 'Call-out' : 'Service'}
          value={formatKes(line.gross)}
        />
      ))}
      <Line
        label={`Fundi-X fee (${formatRate('SERVICE')})`}
        value={`− ${formatKes(release.commission)}`}
      />
      <Line label="You earn" value={formatKes(release.net)} strong />
      <Text style={textStyles.secondary}>
        Released from escrow when the job ended.
      </Text>
    </Card>
  );
}

function Line({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.line}>
      <Text style={[textStyles.secondary, strong && styles.strongLabel]}>
        {label}
      </Text>
      <Text style={[textStyles.primary, strong && styles.strongValue]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  gone: {
    flex: 1,
    justifyContent: 'center',
    gap: 12,
    padding: 20,
  },
  hero: {
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textDark,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  grow: {
    flex: 1,
  },
  call: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySurface,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  actions: {
    gap: 8,
  },
  waiting: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.warning,
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  strongLabel: {
    fontWeight: '700',
    color: colors.textDark,
  },
  strongValue: {
    fontSize: 20,
    fontWeight: '800',
  },
});
