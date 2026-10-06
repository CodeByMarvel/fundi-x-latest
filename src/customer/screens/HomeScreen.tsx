import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Building2, Wrench } from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectionTitle } from '../../shared/components/SectionTitle';
import { useFloatingTabBarSpace } from '../../shared/navigation/tabScreenOptions';
import { colors } from '../../shared/theme/colors';
import { ActiveJobCard } from '../components/home/ActiveJobCard';
import { FindHelpCard } from '../components/home/FindHelpCard';
import { HomeHeader } from '../components/home/HomeHeader';
import type { CustomerStackParamList } from '../navigation/CustomerNavigator';
import { ProviderCard } from '../components/home/ProviderCard';
import { ProviderTypeCard } from '../components/home/ProviderTypeCard';
import { RecentServiceCard } from '../components/home/RecentServiceCard';
import {
  activeJob,
  customer,
  nearbyProviders,
  recentService,
} from '../data/mockHome';

export function HomeScreen() {
  const insets = useSafeAreaInsets();
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
          <ActiveJobCard job={activeJob} />
        </View>
      )}

      <View style={styles.section}>
        <SectionTitle>Find a provider</SectionTitle>
        <View style={styles.row}>
          <ProviderTypeCard label="Mechanic" Icon={Wrench} />
          <ProviderTypeCard label="Garage" Icon={Building2} />
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
          {nearbyProviders.map(provider => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </ScrollView>
      </View>

      {recentService && (
        <View style={styles.section}>
          <SectionTitle>Recent service</SectionTitle>
          <RecentServiceCard service={recentService} />
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
