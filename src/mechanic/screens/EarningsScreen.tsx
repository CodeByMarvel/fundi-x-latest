import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Wallet } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getCategory } from '../../customer/request/data/categories';
import { useProviderJobs } from '../../data/useJob';
import { formatKes } from '../../domain/money';
import { COMMISSION_BPS } from '../../domain/payments/commission';
import { SectionTitle } from '../../shared/components/SectionTitle';
import { formatDateTime } from '../../shared/format';
import { useFloatingTabBarSpace } from '../../shared/navigation/tabScreenOptions';
import { colors } from '../../shared/theme/colors';
import { CURRENT_PROVIDER_ID } from '../data/mockMechanic';
import { earningsFrom, isToday, sumPayouts } from '../earnings';
import type { MechanicStackParamList } from '../navigation/MechanicNavigator';

/** What the provider has earned, worked out from paid jobs. */
export function EarningsScreen() {
  const { top } = useSafeAreaInsets();
  const tabBarSpace = useFloatingTabBarSpace();
  const navigation =
    useNavigation<NativeStackNavigationProp<MechanicStackParamList>>();
  const jobs = useProviderJobs(CURRENT_PROVIDER_ID);

  const earnings = useMemo(() => earningsFrom(jobs), [jobs]);
  const today = sumPayouts(earnings.filter(e => isToday(e.paidAt)));
  const total = sumPayouts(earnings);
  const fees = earnings.reduce((sum, e) => sum + e.commission, 0);

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
            <Text style={styles.heroSmall}>{formatKes(total)}</Text>
          </View>
          <View>
            <Text style={styles.heroSmallLabel}>Paid jobs</Text>
            <Text style={styles.heroSmall}>{earnings.length}</Text>
          </View>
          <View>
            <Text style={styles.heroSmallLabel}>Fundi-X fees</Text>
            <Text style={styles.heroSmall}>{formatKes(fees)}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.note}>
        Fundi-X keeps {COMMISSION_BPS / 100}% of each payment. The rest is
        yours.
      </Text>

      {earnings.length === 0 ? (
        <View style={styles.empty}>
          <Wallet color={colors.textLight} size={32} />
          <Text style={styles.emptyText}>
            Earnings from paid jobs will show up here.
          </Text>
        </View>
      ) : (
        <View style={styles.section}>
          <SectionTitle>Payments</SectionTitle>
          <View style={styles.list}>
            {earnings.map(e => (
              <Pressable
                key={e.job.id}
                style={styles.row}
                onPress={() =>
                  navigation.navigate('MechanicJob', { jobId: e.job.id })
                }
              >
                <View style={styles.rowBody}>
                  <Text style={styles.service}>
                    {getCategory(e.job.categoryId)?.label}
                  </Text>
                  <Text style={styles.meta}>
                    {formatDateTime(e.paidAt)} · paid {formatKes(e.gross)}
                  </Text>
                </View>
                <Text style={styles.payout}>+{formatKes(e.payout)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
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
