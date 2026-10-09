import {
  CircleHelp,
  FileText,
  Mail,
  Smartphone,
  Star,
  Wrench,
} from 'lucide-react-native';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProvider } from '../../data/useJob';
import { formatPhone } from '../../domain/payments/types';
import { Avatar } from '../../shared/components/Avatar';
import { SectionTitle } from '../../shared/components/SectionTitle';
import {
  SettingsList,
  SettingsRow,
} from '../../shared/components/SettingsList';
import { SwitchRoleButton } from '../../shared/components/SwitchRoleButton';
import { useFloatingTabBarSpace } from '../../shared/navigation/tabScreenOptions';
import { colors } from '../../shared/theme/colors';
import { OnlineToggle } from '../components/OnlineToggle';
import { CURRENT_PROVIDER_ID, mechanicProfile } from '../data/mockMechanic';

const comingSoon = (what: string) => () =>
  Alert.alert(what, 'This will be available once accounts are live.');

export function AccountScreen() {
  const { top } = useSafeAreaInsets();
  const tabBarSpace = useFloatingTabBarSpace();
  const provider = useProvider(CURRENT_PROVIDER_ID);
  const fullName = `${mechanicProfile.firstName} ${mechanicProfile.lastName}`;

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
        <OnlineToggle providerId={CURRENT_PROVIDER_ID} />
      </View>

      {provider && (
        <View style={styles.section}>
          <SectionTitle>Profile</SectionTitle>
          <SettingsList>
            <SettingsRow
              Icon={Star}
              label={`${provider.rating.toFixed(1)} rating`}
              value={`From ${provider.ratingCount} jobs`}
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

      <View style={styles.dev}>
        <SwitchRoleButton />
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
  dev: {
    marginTop: 32,
    alignItems: 'center',
  },
});
