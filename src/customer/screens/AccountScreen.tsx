import { Car, CircleHelp, Mail, Shield, Smartphone } from 'lucide-react-native';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../shared/components/Avatar';
import { SectionTitle } from '../../shared/components/SectionTitle';
import {
  SettingsList,
  SettingsRow,
} from '../../shared/components/SettingsList';
import { SwitchRoleButton } from '../../shared/components/SwitchRoleButton';
import { useFloatingTabBarSpace } from '../../shared/navigation/tabScreenOptions';
import { colors } from '../../shared/theme/colors';
import { customer } from '../data/mockHome';
import { mockVehicles, vehicleName } from '../data/mockVehicles';

const comingSoon = (what: string) => () =>
  Alert.alert(what, 'This will be available once accounts are live.');

export function AccountScreen() {
  const { top } = useSafeAreaInsets();
  const tabBarSpace = useFloatingTabBarSpace();
  const fullName = `${customer.firstName} ${customer.lastName}`;

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
          <Text style={styles.meta}>{customer.location}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle>My vehicles</SectionTitle>
        <SettingsList>
          {mockVehicles.map(v => (
            <SettingsRow
              key={v.id}
              Icon={Car}
              label={vehicleName(v)}
              value={v.registration}
            />
          ))}
        </SettingsList>
      </View>

      <View style={styles.section}>
        <SectionTitle>Payment & contact</SectionTitle>
        <SettingsList>
          <SettingsRow
            Icon={Smartphone}
            label="M-Pesa number"
            value={customer.mpesaPhone}
            onPress={comingSoon('Change M-Pesa number')}
          />
          <SettingsRow Icon={Mail} label="Email" value={customer.email} />
        </SettingsList>
      </View>

      <View style={styles.section}>
        <SectionTitle>Help</SectionTitle>
        <SettingsList>
          <SettingsRow
            Icon={CircleHelp}
            label="Help & support"
            onPress={comingSoon('Help & support')}
          />
          <SettingsRow
            Icon={Shield}
            label="Privacy & terms"
            onPress={comingSoon('Privacy & terms')}
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
    marginTop: 28,
  },
  dev: {
    marginTop: 32,
    alignItems: 'center',
  },
});
