import { BadgeCheck, Inbox, Star, Wallet } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { jobRepository } from '../../data/jobRepository';
import { useOfferForProvider, useProviderCurrentJob } from '../../data/useJob';
import { formatKes } from '../../domain/money';
import { HomeHeader } from '../../shared/components/HomeHeader';
import { SectionTitle } from '../../shared/components/SectionTitle';
import { useFloatingTabBarSpace } from '../../shared/navigation/tabScreenOptions';
import { colors } from '../../shared/theme/colors';
import { CurrentJobCard } from '../components/home/CurrentJobCard';
import { JobOfferCard } from '../components/home/JobOfferCard';
import { StatTile } from '../components/home/StatTile';
import {
  CURRENT_PROVIDER_ID,
  currentProvider,
  mechanicProfile,
  todayStats,
} from '../data/mockMechanic';

type Response = 'accept' | 'decline';

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const tabBarSpace = useFloatingTabBarSpace();
  const offer = useOfferForProvider(CURRENT_PROVIDER_ID);
  const currentJob = useProviderCurrentJob(CURRENT_PROVIDER_ID);
  const [responding, setResponding] = useState<Response | null>(null);
  // Blocks a second tap before the re-render that disables the buttons.
  const respondingRef = useRef(false);

  const respond = async (response: Response) => {
    if (!offer || respondingRef.current) {
      return;
    }
    respondingRef.current = true;
    setResponding(response);

    try {
      if (response === 'accept') {
        await jobRepository.acceptOffer(offer.id, CURRENT_PROVIDER_ID);
      } else {
        await jobRepository.declineOffer(offer.id, CURRENT_PROVIDER_ID);
      }
    } catch {
      Alert.alert(
        'This request is no longer available',
        'The customer may have cancelled it.',
      );
    } finally {
      respondingRef.current = false;
      setResponding(null);
    }
  };

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

      <View style={[styles.section, styles.stats]}>
        <StatTile
          Icon={Wallet}
          label="Earned today"
          value={formatKes(todayStats.earnings)}
        />
        <StatTile
          Icon={BadgeCheck}
          label="Jobs today"
          value={String(todayStats.jobsCompleted)}
        />
        <StatTile
          Icon={Star}
          label="Rating"
          value={currentProvider.rating.toFixed(1)}
        />
      </View>

      <View style={styles.section}>
        <SectionTitle>New requests</SectionTitle>
        {offer ? (
          <JobOfferCard
            job={offer}
            distanceKm={currentProvider.distanceKm}
            responding={responding}
            onAccept={() => respond('accept')}
            onDecline={() => respond('decline')}
          />
        ) : (
          <View style={styles.empty}>
            <Inbox color={colors.textLight} size={28} />
            <Text style={styles.emptyTitle}>No new requests</Text>
            <Text style={styles.emptyText}>
              Jobs near you will show up here as soon as customers ask for help.
            </Text>
          </View>
        )}
      </View>

      {currentJob && (
        <View style={styles.section}>
          <SectionTitle>Current job</SectionTitle>
          <CurrentJobCard job={currentJob} />
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
