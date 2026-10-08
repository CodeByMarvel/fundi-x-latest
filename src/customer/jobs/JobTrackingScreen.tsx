import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Check, ChevronLeft, Wrench, X } from 'lucide-react-native';
import { ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { jobRepository } from '../../data/jobRepository';
import { useJob } from '../../data/useJob';
import {
  canTransition,
  JobTransitionError,
} from '../../domain/jobs/transitions';
import { Job } from '../../domain/jobs/types';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { colors } from '../../shared/theme/colors';
import { vehicleName } from '../data/mockVehicles';
import type { CustomerStackParamList } from '../navigation/CustomerNavigator';
import { getCategory } from '../request/data/categories';
import { customerStatusView, jobProgress } from './jobPresentation';

type Props = NativeStackScreenProps<CustomerStackParamList, 'JobTracking'>;

/**
 * One screen for the whole life of a job. It never decides what state the
 * job is in; it shows whatever the repository says and re-renders on change.
 */
export function JobTrackingScreen({ navigation, route }: Props) {
  const { top, bottom } = useSafeAreaInsets();
  const job = useJob(route.params.jobId);
  const [cancelling, setCancelling] = useState(false);

  if (!job) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: top }]}>
        <Text style={styles.subtitle}>We couldn't find this job.</Text>
        <PrimaryButton label="Back" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const view = customerStatusView(job.status);
  const canCancel = canTransition(job.status, 'CANCELLED', 'CUSTOMER');

  const cancel = async () => {
    setCancelling(true);
    try {
      await jobRepository.cancelJob(job.id);
    } catch (error) {
      Alert.alert(
        "Couldn't cancel",
        error instanceof JobTransitionError
          ? 'Your job has already moved on and can no longer be cancelled here.'
          : 'Please try again.',
      );
    } finally {
      setCancelling(false);
    }
  };

  const confirmCancel = () =>
    Alert.alert('Cancel this request?', "We'll stop looking for a fundi.", [
      { text: 'Keep request', style: 'cancel' },
      { text: 'Cancel request', style: 'destructive', onPress: cancel },
    ]);

  return (
    <View style={[styles.screen, { paddingTop: top }]}>
      <View style={styles.topBar}>
        <Pressable
          style={styles.iconButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <ChevronLeft color={colors.textDark} size={24} />
        </Pressable>
        <Text style={styles.topTitle}>Your job</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
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

        <View style={styles.card}>
          <Detail label="Vehicle">
            <Text style={styles.primary}>{vehicleName(job.vehicle)}</Text>
            <Text style={styles.secondary}>{job.vehicle.registration}</Text>
          </Detail>
          <Detail label="Problem">
            <Text style={styles.primary}>
              {getCategory(job.categoryId)?.label}
            </Text>
            {!!job.description && (
              <Text style={styles.secondary}>{job.description}</Text>
            )}
          </Detail>
          <Detail label="Location">
            <Text style={styles.primary}>{job.location.label}</Text>
            <Text style={styles.secondary}>{job.location.address}</Text>
          </Detail>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottom + 16 }]}>
        {canCancel && (
          <PrimaryButton
            variant="ghost"
            label={cancelling ? 'Cancelling…' : 'Cancel request'}
            onPress={confirmCancel}
            disabled={cancelling}
          />
        )}
        {view.tone === 'stopped' && (
          <PrimaryButton
            label="Back to home"
            onPress={() => navigation.popToTop()}
          />
        )}
      </View>
    </View>
  );
}

function StatusIcon({ job }: { job: Job }) {
  const view = customerStatusView(job.status);
  const searching = job.status === 'SEARCHING' || job.status === 'OFFERED';

  return (
    <View
      style={[
        styles.icon,
        view.tone === 'success' && styles.iconSuccess,
        view.tone === 'stopped' && styles.iconStopped,
      ]}
    >
      {searching ? (
        <ActivityIndicator color={colors.primary} size="large" />
      ) : view.tone === 'success' ? (
        <Check color={colors.surface} size={36} strokeWidth={3} />
      ) : view.tone === 'stopped' ? (
        <X color={colors.surface} size={36} strokeWidth={3} />
      ) : (
        <Wrench color={colors.primary} size={32} />
      )}
    </View>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      {children}
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textGrey,
  },
  content: {
    padding: 20,
    gap: 24,
  },
  hero: {
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
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
    maxWidth: 300,
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
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
    gap: 16,
  },
  detail: {
    gap: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textGrey,
    marginBottom: 2,
  },
  primary: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textDark,
  },
  secondary: {
    fontSize: 14,
    color: colors.textGrey,
  },
  footer: {
    paddingHorizontal: 20,
    gap: 8,
  },
});
