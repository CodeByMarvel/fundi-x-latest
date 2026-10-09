import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Wallet } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getCategory } from '../../customer/request/data/categories';
import { useJob, useProviderReleases } from '../../data/useJob';
import { formatRate } from '../../domain/billing/commission';
import { Release } from '../../domain/billing/types';
import { formatKes } from '../../domain/money';
import { SectionTitle } from '../../shared/components/SectionTitle';
import { formatDateTime } from '../../shared/format';
import { useFloatingTabBarSpace } from '../../shared/navigation/tabScreenOptions';
import { colors } from '../../shared/theme/colors';
import { CURRENT_PROVIDER_ID } from '../data/mockMechanic';
import { isToday, sumCommission, sumNet } from '../earnings';
import type { MechanicStackParamList } from '../navigation/MechanicNavigator';

/** What the provider has earned: every release from escrow to them. */
export function EarningsScreen() {
  const { top } = useSafeAreaInsets();
  const tabBarSpace = useFloatingTabBarSpace();
  const releases = useProviderReleases(CURRENT_PROVIDER_ID);

  const today = sumNet(releases.filter(r => isToday(r.createdAt)));

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: top + 16, paddingBottom: tabBarSpace },
      ]}
    >
      <Text style={styles.heading}>Earnings</Text>

      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Today</Text>
        <Text style={styles.heroValue}>{formatKes(today)}</Text>
        <View style={styles.heroRow}>
          <View>
            <Text style={styles.heroSmallLabel}>All time</Text>
            <Text style={styles.heroSmall}>{formatKes(sumNet(releases))}</Text>
          </View>
          <View>
            <Text style={styles.heroSmallLabel}>Payouts</Text>
            <Text style={styles.heroSmall}>{releases.length}</Text>
          </View>
          <View>
            <Text style={styles.heroSmallLabel}>Fundi-X fees</Text>
            <Text style={styles.heroSmall}>
              {formatKes(sumCommission(releases))}
            </Text>
          </View>
        </View>
      </View>
      <Text style={styles.note}>
        Customers pay into Fundi-X escrow. When a job ends, it’s released to you
        minus a {formatRate('SERVICE')} fee.
      </Text>

      {releases.length === 0 ? (
        <View style={styles.empty}>
          <Wallet color={colors.textLight} size={32} />
          <Text style={styles.emptyText}>
            Earnings from finished jobs will show up here.
          </Text>
        </View>
      ) : (
        <View style={styles.section}>
          <SectionTitle>Payouts</SectionTitle>
          <View style={styles.list}>
            {releases.map(r => (
              <PayoutRow key={r.id} release={r} />
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function PayoutRow({ release }: { release: Release }) {
  const navigation =
    useNavigation<NativeStackNavigationProp<MechanicStackParamList>>();
  const job = useJob(release.jobId);
  const callOutOnly = release.lines.every(l => l.purpose === 'CALL_OUT');

  return (
    <Pressable
      style={styles.row}
      onPress={() =>
        navigation.navigate('MechanicJob', { jobId: release.jobId })
      }
    >
      <View style={styles.rowBody}>
        <Text style={styles.service}>
          {job ? getCategory(job.categoryId)?.label : release.jobId}
        </Text>
        <Text style={styles.meta}>
          {formatDateTime(release.createdAt)} ·{' '}
          {callOutOnly ? 'call-out only' : `paid ${formatKes(release.gross)}`}
        </Text>
      </View>
      <Text style={styles.payout}>+{formatKes(release.net)}</Text>
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
  hero: {
    marginTop: 20,
    padding: 20,
    borderRadius: 20,
    backgroundColor: colors.textDark,
    gap: 4,
  },
  heroLabel: {
    fontSize: 14,
    color: colors.inactive,
  },
  heroValue: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.surface,
  },
  heroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  heroSmallLabel: {
    fontSize: 12,
    color: colors.inactive,
  },
  heroSmall: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.surface,
    marginTop: 2,
  },
  note: {
    fontSize: 13,
    color: colors.textGrey,
    marginTop: 10,
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
  },
  service: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textDark,
  },
  meta: {
    fontSize: 13,
    color: colors.textGrey,
    marginTop: 2,
  },
  payout: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.success,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    marginTop: 40,
  },
  emptyText: {
    fontSize: 15,
    color: colors.textGrey,
  },
});
