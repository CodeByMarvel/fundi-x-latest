import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Briefcase, ChevronRight } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { vehicleName } from '../../customer/data/mockVehicles';
import { getCategory } from '../../customer/request/data/categories';
import {
  useJobLedger,
  useOfferForProvider,
  useProviderJobs,
} from '../../data/useJob';
import { isTerminalStatus } from '../../domain/jobs/transitions';
import { Job } from '../../domain/jobs/types';
import { formatKes } from '../../domain/money';
import { SectionTitle } from '../../shared/components/SectionTitle';
import { StatusPill } from '../../shared/components/StatusPill';
import { formatDate } from '../../shared/format';
import { useFloatingTabBarSpace } from '../../shared/navigation/tabScreenOptions';
import { colors } from '../../shared/theme/colors';
import { CURRENT_PROVIDER_ID } from '../data/mockMechanic';
import { providerJobView } from '../jobs/providerJobPresentation';
import type { MechanicStackParamList } from '../navigation/MechanicNavigator';

/** The provider's offer, current job and history in one list. */
export function JobsScreen() {
  const { top } = useSafeAreaInsets();
  const tabBarSpace = useFloatingTabBarSpace();
  const navigation =
    useNavigation<NativeStackNavigationProp<MechanicStackParamList>>();
  const offer = useOfferForProvider(CURRENT_PROVIDER_ID);
  const jobs = useProviderJobs(CURRENT_PROVIDER_ID);

  const [active, past] = useMemo(
    () => [
      jobs.filter(job => !isTerminalStatus(job.status)),
      jobs.filter(job => isTerminalStatus(job.status)),
    ],
    [jobs],
  );

  const open = (job: Job) =>
    navigation.navigate('MechanicJob', { jobId: job.id });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: top + 16, paddingBottom: tabBarSpace },
      ]}
    >
      <Text style={styles.heading}>Jobs</Text>

      {!offer && jobs.length === 0 && (
        <View style={styles.empty}>
          <Briefcase color={colors.textLight} size={32} />
          <Text style={styles.emptyTitle}>No jobs yet</Text>
          <Text style={styles.emptyText}>
            Jobs you accept will appear here, along with your history.
          </Text>
        </View>
      )}

      {offer && (
        <Section title="Waiting for your answer">
          <JobRow job={offer} onPress={() => open(offer)} />
        </Section>
      )}
      {active.length > 0 && (
        <Section title="Active">
          {active.map(job => (
            <JobRow key={job.id} job={job} onPress={() => open(job)} />
          ))}
        </Section>
      )}
      {past.length > 0 && (
        <Section title="History">
          {past.map(job => (
            <JobRow key={job.id} job={job} onPress={() => open(job)} />
          ))}
        </Section>
      )}
    </ScrollView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <SectionTitle>{title}</SectionTitle>
      <View style={styles.list}>{children}</View>
    </View>
  );
}

function JobRow({ job, onPress }: { job: Job; onPress: () => void }) {
  const view = providerJobView(job);
  const { release } = useJobLedger(job.id);
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.service} numberOfLines={1}>
            {getCategory(job.categoryId)?.label}
          </Text>
          {release && (
            <Text style={styles.amount}>{formatKes(release.net)}</Text>
          )}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {vehicleName(job.vehicle)} · {job.location.address}
        </Text>
        <Text style={styles.meta}>{formatDate(job.createdAt)}</Text>
        <View style={styles.pill}>
          <StatusPill label={view.title} tone={view.tone} />
        </View>
      </View>
      <ChevronRight color={colors.textLight} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 20,
  },
  heading: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textDark,
  },
  section: {
    marginTop: 24,
  },
  list: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  service: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textDark,
  },
  amount: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.success,
  },
  meta: {
    fontSize: 13,
    color: colors.textGrey,
  },
  pill: {
    marginTop: 6,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    marginTop: 48,
    paddingHorizontal: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textDark,
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    color: colors.textGrey,
  },
});
