import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { jobRepository } from '../../../data/backend';
import { createInputFromJob } from '../../../domain/jobs/jobs';
import { Job } from '../../../domain/jobs/types';
import { Card, textStyles } from '../../../shared/components/Card';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { useAsyncAction } from '../../../shared/hooks/useAsyncAction';
import type { CustomerStackParamList } from '../../navigation/CustomerNavigator';

/** Shown on a cancelled job: what happened, and a way to try again. */
export function CancelledPanel({ job }: { job: Job }) {
  const navigation =
    useNavigation<NativeStackNavigationProp<CustomerStackParamList>>();
  const { pending, run } = useAsyncAction<'again'>();
  const reason = job.cancellation?.reason;
  const canRetry =
    reason === 'provider_cancelled' ||
    reason === 'no_provider_available' ||
    reason === 'customer_cancelled';

  const requestAgain = () =>
    run('again', async () => {
      const next = await jobRepository.createJob(createInputFromJob(job));
      navigation.replace('JobTracking', { jobId: next.id });
    });

  return (
    <View style={styles.wrap}>
      {job.cancellation?.note && (
        <Card title="Message from your fundi">
          <Text style={textStyles.quote}>“{job.cancellation.note}”</Text>
        </Card>
      )}
      {canRetry && (
        <PrimaryButton
          label={
            reason === 'provider_cancelled'
              ? 'Find another fundi'
              : 'Request again'
          }
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
        You won't be asked to pay until this is sorted out.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
  },
});
