import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { jobRepository, pricingService } from '../../../data/backend';
import { requestDetailsFromJob } from '../../../domain/jobs/jobs';
import { CancellationReason, Job } from '../../../domain/jobs/types';
import { formatKes } from '../../../domain/money';
import { Card, textStyles } from '../../../shared/components/Card';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { useAsyncAction } from '../../../shared/hooks/useAsyncAction';
import type { CustomerStackParamList } from '../../navigation/CustomerNavigator';

/** Endings where booking the same job again makes sense. */
const RETRYABLE: CancellationReason[] = [
  'call_out_unpaid',
  'customer_cancelled',
  'no_provider_available',
  'customer_no_show',
];

/** Shown on a cancelled job: a way to try again, and the way home. */
export function CancelledPanel({ job }: { job: Job }) {
  const navigation =
    useNavigation<NativeStackNavigationProp<CustomerStackParamList>>();
  const { pending, run } = useAsyncAction<'again'>();
  const canRetry =
    !!job.cancellation && RETRYABLE.includes(job.cancellation.reason);

  // A new booking needs a fresh price and a fresh call-out payment.
  const requestAgain = () =>
    run('again', async () => {
      const details = requestDetailsFromJob(job);
      const estimate = await pricingService.estimate(details);
      Alert.alert(
        'Book again?',
        `The call-out is ${formatKes(estimate.callOut)}${
          estimate.fixedService
            ? `, and the service is ${formatKes(
                estimate.fixedService.total,
              )} (paid at the end)`
            : ''
        }.`,
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Book',
            onPress: () =>
              run('again', async () => {
                const next = await jobRepository.createJob({
                  ...details,
                  acceptedPrice: {
                    callOut: estimate.callOut,
                    fixedServiceTotal: estimate.fixedService?.total,
                  },
                });
                navigation.replace('JobTracking', { jobId: next.id });
              }),
          },
        ],
      );
    });

  return (
    <View style={styles.wrap}>
      {canRetry && (
        <PrimaryButton
          label="Request again"
          onPress={requestAgain}
          loading={pending === 'again'}
        />
      )}
      <PrimaryButton
        variant={canRetry ? 'ghost' : 'primary'}
        label="Back to home"
        onPress={() => navigation.popToTop()}
      />
    </View>
  );
}

/** Shown while support reviews the customer's report. */
export function DisputePanel({ job }: { job: Job }) {
  return (
    <Card title="Your report">
      <Text style={textStyles.quote}>“{job.dispute?.reason}”</Text>
      <Text style={textStyles.secondary}>
        Your money stays with Fundi-X until this is sorted out.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
  },
});
