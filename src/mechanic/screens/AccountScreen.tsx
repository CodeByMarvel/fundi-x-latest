import {
  ShieldCheck,
  CircleHelp,
  FileText,
  Mail,
  Smartphone,
  Star,
  Wrench,
} from 'lucide-react-native';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProvider, useReliabilityEvents } from '../../data/useJob';
import { formatPhone } from '../../domain/billing/types';
import { Avatar } from '../../shared/components/Avatar';
import { SectionTitle } from '../../shared/components/SectionTitle';
import {
  SettingsList,
  SettingsRow,
} from '../../shared/components/SettingsList';
import { AccountActions, useSignedInAccount } from '../../auth/AccountActions';
import { useFloatingTabBarSpace } from '../../shared/navigation/tabScreenOptions';
import { colors } from '../../shared/theme/colors';
import { OnlineToggle } from '../components/OnlineToggle';
import { useCurrentProviderId, useMechanicProfile } from '../data/currentMechanic';

const VERIFICATION = {
  PENDING: 'Waiting for Fundi-X to verify you',
  VERIFIED: 'Verified by Fundi-X',
  REJECTED: 'Not approved yet: update your profile to send it again',
} as const;

const comingSoon = (what: string) => () =>
  Alert.alert(what, 'This will be available once accounts are live.');

export function AccountScreen() {
  const { top } = useSafeAreaInsets();
  const tabBarSpace = useFloatingTabBarSpace();
  const me = useCurrentProviderId();
  const mechanicProfile = useMechanicProfile();
  const provider = useProvider(me);
  const reliability = useReliabilityEvents(me);
  // The signed-in account's details; demo mode shows the sample mechanic.
  const account = useSignedInAccount();
  const fullName =
    account?.provider?.businessName ??
    account?.name ??
    `${mechanicProfile.firstName} ${mechanicProfile.lastName}`;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: top + 16, paddingBottom: tabBarSpace },
      ]}
    >
      <View style={styles.profile}>
        <Avatar name={fullName} size={64} />
        <View>
          <Text style={styles.name}>{fullName}</Text>
          <Text style={styles.meta}>{mechanicProfile.location}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <OnlineToggle providerId={me} />
      </View>

      {account?.provider && (
        <View style={styles.section}>
          <SectionTitle>Profile</SectionTitle>
          <SettingsList>
            <SettingsRow
              Icon={ShieldCheck}
              label="Verification"
              value={
                account.provider.verification === 'REJECTED' &&
                account.provider.verificationNote
                  ? `${VERIFICATION.REJECTED}. Fundi-X says: ${account.provider.verificationNote}`
                  : VERIFICATION[account.provider.verification]
              }
            />
            <SettingsRow
              Icon={Wrench}
              label="Specialty"
              value={account.provider.specialty}
            />
            <SettingsRow
              Icon={Smartphone}
              label="M-Pesa for payouts"
              value={account.phone ? formatPhone(account.phone) : 'Not set'}
            />
            <SettingsRow Icon={Mail} label="Email" value={account.email ?? 'Not set'} />
          </SettingsList>
        </View>
      )}

      {!account && provider && (
        <View style={styles.section}>
          <SectionTitle>Profile</SectionTitle>
          <SettingsList>
            <SettingsRow
              Icon={Star}
              label={`${provider.rating.toFixed(1)} rating`}
              value={`From ${provider.ratingCount} jobs`}
            />
            <SettingsRow
              Icon={ShieldCheck}
              label="Reliability"
              value={
                reliability.length === 0
                  ? 'No missed or dropped jobs'
                  : `${reliability.length} recorded: declined, expired, withdrawn or late jobs`
              }
            />
            <SettingsRow
              Icon={Wrench}
              label="Specialty"
              value={provider.specialty}
              onPress={comingSoon('Edit specialty')}
            />
            <SettingsRow
              Icon={Smartphone}
              label="M-Pesa for payouts"
              value={formatPhone(provider.phone)}
              onPress={comingSoon('Change payout number')}
            />
            <SettingsRow
              Icon={Mail}
              label="Email"
              value={mechanicProfile.email}
            />
          </SettingsList>
        </View>
      )}

      <View style={styles.section}>
        <SectionTitle>Help</SectionTitle>
        <SettingsList>
          <SettingsRow
            Icon={CircleHelp}
            label="Provider support"
            onPress={comingSoon('Provider support')}
          />
          <SettingsRow
            Icon={FileText}
            label="Fees & terms"
            onPress={comingSoon('Fees & terms')}
          />
        </SettingsList>
      </View>

      <AccountActions />
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
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textDark,
  },
  meta: {
    fontSize: 14,
    color: colors.textGrey,
    marginTop: 2,
  },
  section: {
    marginTop: 24,
  },
});
