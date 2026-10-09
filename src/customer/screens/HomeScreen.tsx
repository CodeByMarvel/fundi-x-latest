import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Building2, Wrench } from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useActiveJob,
  useJobLedger,
  useLatestCompletedJob,
  useProviders,
} from '../../data/useJob';
import { formatKes } from '../../domain/money';
import { formatDate } from '../../shared/format';
import { SectionTitle } from '../../shared/components/SectionTitle';
import { useFloatingTabBarSpace } from '../../shared/navigation/tabScreenOptions';
import { colors } from '../../shared/theme/colors';
import { ActiveJobCard } from '../components/home/ActiveJobCard';
import { FindHelpCard } from '../components/home/FindHelpCard';
import { HomeHeader } from '../../shared/components/HomeHeader';
import type { CustomerStackParamList } from '../navigation/CustomerNavigator';
import { ProviderCard } from '../components/home/ProviderCard';
import { ProviderTypeCard } from '../components/home/ProviderTypeCard';
import { RecentServiceCard } from '../components/home/RecentServiceCard';
import { customer } from '../data/mockHome';
import { vehicleName } from '../data/mockVehicles';
import { customerJobView, jobProgress } from '../jobs/jobPresentation';
import { getCategory } from '../request/data/categories';

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const activeJob = useActiveJob();
  const recentJob = useLatestCompletedJob();
  const recentLedger = useJobLedger(recentJob?.id ?? '');
  const providers = useProviders();
  const tabBarSpace = useFloatingTabBarSpace();
  const navigation =
    useNavigation<NativeStackNavigationProp<CustomerStackParamList>>();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: tabBarSpace },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <HomeHeader firstName={customer.firstName} location={customer.location} />

      <View style={styles.section}>
        <FindHelpCard onPress={() => navigation.navigate('RequestFlow')} />
      </View>

      {activeJob && (
        <View style={styles.section}>
          <SectionTitle>Active job</SectionTitle>
          <ActiveJobCard
            car={vehicleName(activeJob.vehicle)}
            service={getCategory(activeJob.categoryId)?.label ?? ''}
            status={customerJobView(activeJob).short}
            progress={jobProgress(activeJob.status)}
            onViewJob={() =>
              navigation.navigate('JobTracking', { jobId: activeJob.id })
            }
          />
        </View>
      )}

      <View style={styles.section}>
        <SectionTitle>Find a provider</SectionTitle>
        <View style={styles.row}>
          <ProviderTypeCard
            label="Mechanic"
            Icon={Wrench}
            onPress={() => navigation.navigate('RequestFlow')}
          />
          <ProviderTypeCard
            label="Garage"
            Icon={Building2}
            onPress={() => navigation.navigate('RequestFlow')}
          />
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle>Nearby / Recommended</SectionTitle>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.bleed}
          contentContainerStyle={styles.providerList}
        >
          {providers.map(provider => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </ScrollView>
      </View>

      {recentJob && (
        <View style={styles.section}>
          <SectionTitle>Recent service</SectionTitle>
          <RecentServiceCard
            service={{
              id: recentJob.id,
              car: vehicleName(recentJob.vehicle),
              service: getCategory(recentJob.categoryId)?.label ?? '',
              date: formatDate(recentJob.completedAt ?? recentJob.updatedAt),
              price: recentLedger.totalPaid
                ? formatKes(recentLedger.totalPaid)
                : '',
            }}
            onPress={() =>
              navigation.navigate('JobTracking', { jobId: recentJob.id })
            }
          />
        </View>
      )}
    </ScrollView>
  );
}

const SCREEN_PADDING = 20;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: SCREEN_PADDING,
  },
  section: {
    marginTop: 28,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  // Lets the horizontal list scroll edge to edge while staying aligned.
  bleed: {
    marginHorizontal: -SCREEN_PADDING,
  },
  providerList: {
    paddingHorizontal: SCREEN_PADDING,
    gap: 12,
  },
});
