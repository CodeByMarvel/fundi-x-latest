import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BadgeCheck, Inbox, Star, Wallet } from 'lucide-react-native';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { jobRepository } from '../../data/backend';
import {
  useOfferForProvider,
  useProvider,
  useProviderCurrentJob,
  useProviderReleases,
} from '../../data/useJob';
import { formatKes } from '../../domain/money';
import { HomeHeader } from '../../shared/components/HomeHeader';
import { SectionTitle } from '../../shared/components/SectionTitle';
import { useAsyncAction } from '../../shared/hooks/useAsyncAction';
import { useFloatingTabBarSpace } from '../../shared/navigation/tabScreenOptions';
import { colors } from '../../shared/theme/colors';
import { CurrentJobCard } from '../components/home/CurrentJobCard';
import { JobOfferCard } from '../components/home/JobOfferCard';
import { StatTile } from '../components/home/StatTile';
import { OnlineToggle } from '../components/OnlineToggle';
import { CURRENT_PROVIDER_ID, mechanicProfile } from '../data/mockMechanic';
import { isToday, sumNet } from '../earnings';
import type { MechanicStackParamList } from '../navigation/MechanicNavigator';

const me = CURRENT_PROVIDER_ID;

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const tabBarSpace = useFloatingTabBarSpace();
  const navigation =
    useNavigation<NativeStackNavigationProp<MechanicStackParamList>>();
  const provider = useProvider(me);
  const offer = useOfferForProvider(me);
  const currentJob = useProviderCurrentJob(me);
  const releases = useProviderReleases(me);
  const { pending, run } = useAsyncAction<'accept' | 'decline'>();

  const today = useMemo(() => {
    const todays = releases.filter(r => isToday(r.createdAt));
    return { payout: sumNet(todays), jobs: todays.length };
  }, [releases]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: tabBarSpace },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <HomeHeader
        firstName={mechanicProfile.firstName}
        location={mechanicProfile.location}
      />

      <View style={styles.section}>
        <OnlineToggle providerId={me} />
      </View>

      <View style={[styles.section, styles.stats]}>
        <StatTile
          Icon={Wallet}
          label="Earned today"
          value={formatKes(today.payout)}
        />
        <StatTile
          Icon={BadgeCheck}
          label="Paid jobs today"
          value={String(today.jobs)}
        />
        <StatTile
          Icon={Star}
          label="Rating"
          value={provider ? provider.rating.toFixed(1) : '–'}
        />
      </View>

      {currentJob && (
        <View style={styles.section}>
          <SectionTitle>Current job</SectionTitle>
          <CurrentJobCard
            job={currentJob}
            onPress={() =>
              navigation.navigate('MechanicJob', { jobId: currentJob.id })
            }
          />
        </View>
      )}

      <View style={styles.section}>
        <SectionTitle>New requests</SectionTitle>
        {offer ? (
          <JobOfferCard
            job={offer}
            distanceKm={provider?.distanceKm ?? 0}
            responding={pending}
            onAccept={() =>
              run('accept', async () => {
                await jobRepository.acceptOffer(offer.id, me);
                navigation.navigate('MechanicJob', { jobId: offer.id });
              })
            }
            onDecline={() =>
              run('decline', () => jobRepository.declineOffer(offer.id, me))
            }
          />
        ) : (
          <View style={styles.empty}>
            <Inbox color={colors.textLight} size={28} />
            <Text style={styles.emptyTitle}>No new requests</Text>
            <Text style={styles.emptyText}>
              {!provider?.online
                ? 'Go online to start receiving jobs.'
                : currentJob
                ? "You'll get new requests once you finish your current job."
                : 'Jobs near you will show up here as soon as customers ask for help.'}
            </Text>
          </View>
        )}
      </View>
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
  section: {
    marginTop: 28,
  },
  stats: {
    flexDirection: 'row',
    gap: 10,
  },
  empty: {
    alignItems: 'center',
    padding: 24,
    gap: 6,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
    borderStyle: 'dashed',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textDark,
    marginTop: 4,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    color: colors.textGrey,
  },
});
