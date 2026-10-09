import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Check, CircleAlert, Wrench, X } from 'lucide-react-native';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { jobRepository } from '../../data/backend';
import { useJob } from '../../data/useJob';
import { canTransition } from '../../domain/jobs/transitions';
import { Job, JobStatus } from '../../domain/jobs/types';
import { MapPlaceholder } from '../../shared/components/MapPlaceholder';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { ScreenHeader } from '../../shared/components/ScreenHeader';
import { useAsyncAction } from '../../shared/hooks/useAsyncAction';
import { colors } from '../../shared/theme/colors';
import type { CustomerStackParamList } from '../navigation/CustomerNavigator';
import { customerJobView, jobProgress } from './jobPresentation';
import { CancelledPanel, DisputePanel } from './panels/ClosedPanels';
import { CompletionPanel } from './panels/CompletionPanel';
import { JobDetailsCard } from './panels/JobDetailsCard';
import { PaymentPanel } from './panels/PaymentPanel';
import { ProviderPanel } from './panels/ProviderPanel';
import { ApprovedWorkPanel, QuoteReviewPanel } from './panels/QuotePanels';
import { RatingPanel, ReceiptPanel } from './panels/ReceiptPanel';

type Props = NativeStackScreenProps<CustomerStackParamList, 'JobTracking'>;

/** Statuses where the provider's card is worth showing. */
const SHOW_PROVIDER: JobStatus[] = [
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'DIAGNOSING',
  'QUOTE_SENT',
  'IN_PROGRESS',
  'AWAITING_CONFIRMATION',
  'PAYMENT_PENDING',
  'DISPUTED',
];

/**
 * One screen for the whole life of a job. It never decides what state the
 * job is in: it shows whatever the backend says and re-renders on change,
 * picking the panel that fits the current status.
 */
export function JobTrackingScreen({ navigation, route }: Props) {
  const { top, bottom } = useSafeAreaInsets();
  const job = useJob(route.params.jobId);
  const { pending, run } = useAsyncAction<'cancel'>();

  if (!job) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: top }]}>
        <Text style={styles.subtitle}>We couldn't find this job.</Text>
        <PrimaryButton label="Back" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const view = customerJobView(job);
  // The rulebook decides whether cancelling is allowed, not this screen.
  const canCancel = canTransition(job.status, 'CANCELLED', 'CUSTOMER');

  const confirmCancel = () =>
    Alert.alert(
      'Cancel this request?',
      job.status === 'SEARCHING' || job.status === 'OFFERED'
        ? "We'll stop looking for a fundi."
        : 'Your fundi is already on the job. Please only cancel if you really need to.',
      [
        { text: 'Keep request', style: 'cancel' },
        {
          text: 'Cancel request',
          style: 'destructive',
          onPress: () => run('cancel', () => jobRepository.cancelJob(job.id)),
        },
      ],
    );

  return (
    <View style={[styles.screen, { paddingTop: top }]}>
      <ScreenHeader title="Your job" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <StatusIcon job={job} />
          <Text style={styles.title}>{view.title}</Text>
          <Text style={styles.subtitle}>{view.subtitle}</Text>
        </View>

        {view.tone !== 'stopped' && (
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.round(jobProgress(job.status) * 100)}%` },
              ]}
            />
          </View>
        )}

        {job.status === 'EN_ROUTE' && (
          <MapPlaceholder
            address={job.location.address}
            caption={
              job.etaMinutes
                ? `Arriving in about ${job.etaMinutes} min`
                : undefined
            }
          />
        )}

        {SHOW_PROVIDER.includes(job.status) && <ProviderPanel job={job} />}

        <StagePanel job={job} />

        <JobDetailsCard job={job} />

        {canCancel && (
          <PrimaryButton
            variant="ghost"
            label="Cancel request"
            onPress={confirmCancel}
            loading={pending === 'cancel'}
          />
        )}
      </ScrollView>
    </View>
  );
}

/** The part of the screen that changes most from stage to stage. */
function StagePanel({ job }: { job: Job }) {
  switch (job.status) {
    case 'QUOTE_SENT':
      return <QuoteReviewPanel job={job} />;
    case 'IN_PROGRESS':
      return <ApprovedWorkPanel job={job} />;
    case 'AWAITING_CONFIRMATION':
      return <CompletionPanel job={job} />;
    case 'PAYMENT_PENDING':
      return <PaymentPanel job={job} />;
    case 'PAID':
      return <ReceiptPanel job={job} />;
    case 'COMPLETED':
      return (
        <>
          <RatingPanel job={job} />
          <ReceiptPanel job={job} />
        </>
      );
    case 'CANCELLED':
      return <CancelledPanel job={job} />;
    case 'DISPUTED':
      return <DisputePanel job={job} />;
    default:
      return null;
  }
}

function StatusIcon({ job }: { job: Job }) {
  const { tone } = customerJobView(job);
  const searching = job.status === 'SEARCHING' || job.status === 'OFFERED';

  return (
    <View
      style={[
        styles.icon,
        tone === 'success' && styles.iconSuccess,
        tone === 'stopped' && styles.iconStopped,
        tone === 'warning' && styles.iconWarning,
      ]}
    >
      {searching ? (
        <ActivityIndicator color={colors.primary} size="large" />
      ) : tone === 'success' ? (
        <Check color={colors.surface} size={36} strokeWidth={3} />
      ) : tone === 'stopped' ? (
        <X color={colors.surface} size={36} strokeWidth={3} />
      ) : tone === 'warning' ? (
        <CircleAlert color={colors.surface} size={36} />
      ) : (
        <Wrench color={colors.primary} size={32} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 20,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  hero: {
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  icon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySurface,
    marginBottom: 12,
  },
  iconSuccess: {
    backgroundColor: colors.success,
  },
  iconStopped: {
    backgroundColor: colors.inactive,
  },
  iconWarning: {
    backgroundColor: colors.warning,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    color: colors.textDark,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    color: colors.textGrey,
    maxWidth: 320,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
});
