import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { jobRepository } from '../../../data/backend';
import { Job } from '../../../domain/jobs/types';
import { Card, textStyles } from '../../../shared/components/Card';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { TextField } from '../../../shared/components/TextField';
import { useAsyncAction } from '../../../shared/hooks/useAsyncAction';
import { ApprovedWorkPanel } from './QuotePanels';

/**
 * The provider says they're done: the customer checks the work, then either
 * confirms (and moves on to paying) or reports a problem.
 */
export function CompletionPanel({ job }: { job: Job }) {
  const { pending, run } = useAsyncAction<'confirm' | 'dispute'>();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <>
      <Card title="What your fundi did">
        <Text style={job.workSummary ? textStyles.quote : textStyles.secondary}>
          {job.workSummary ? `“${job.workSummary}”` : 'No notes added.'}
        </Text>
      </Card>
      <ApprovedWorkPanel job={job} title="Work done" />

      {reporting ? (
        <Card title="Report a problem">
          <Text style={textStyles.secondary}>
            Tell us what isn't right. Fundi-X support will review it with your
            fundi before you pay anything.
          </Text>
          <TextField
            multiline
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. The brakes still make a grinding noise"
            autoFocus
          />
          <View style={styles.actions}>
            <PrimaryButton
              label="Send report"
              onPress={() =>
                run('dispute', () =>
                  jobRepository.disputeCompletion(job.id, reason),
                )
              }
              loading={pending === 'dispute'}
              disabled={!reason.trim()}
            />
            <PrimaryButton
              variant="ghost"
              label="Back"
              onPress={() => setReporting(false)}
              disabled={pending !== null}
            />
          </View>
        </Card>
      ) : (
        <View style={styles.actions}>
          <PrimaryButton
            label="Everything's fine, continue to pay"
            onPress={() =>
              run('confirm', () => jobRepository.confirmCompletion(job.id))
            }
            loading={pending === 'confirm'}
            disabled={pending !== null}
          />
          <PrimaryButton
            variant="outline"
            label="Report a problem"
            onPress={() => setReporting(true)}
            disabled={pending !== null}
          />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 8,
  },
});
