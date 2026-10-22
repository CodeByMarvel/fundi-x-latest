import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Briefcase, Car, CircleHelp, House, Mail, Plus, Shield, Smartphone } from 'lucide-react-native';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../shared/components/Avatar';
import { SectionTitle } from '../../shared/components/SectionTitle';
import {
  SettingsList,
  SettingsRow,
} from '../../shared/components/SettingsList';
import { AccountActions, useSignedInAccount } from '../../auth/AccountActions';
import { useFloatingTabBarSpace } from '../../shared/navigation/tabScreenOptions';
import { colors } from '../../shared/theme/colors';
import { useCustomerProfile } from '../data/currentCustomer';
import { useSavedPlaces } from '../data/places';
import { ServerError } from '../../auth/api';
import { Vehicle, vehicleName } from '../../domain/jobs/request';
import { useVehicles } from '../data/vehicles';
import type { CustomerStackParamList } from '../navigation/CustomerNavigator';

const comingSoon = (what: string) => () =>
  Alert.alert(what, 'This will be available once accounts are live.');

export function AccountScreen() {
  const { top } = useSafeAreaInsets();
  const tabBarSpace = useFloatingTabBarSpace();
  // The signed-in account's details; demo mode shows the sample customer.
  const account = useSignedInAccount();
  const customer = useCustomerProfile();
  const { home, work } = useSavedPlaces();
  const { vehicles, remove } = useVehicles();
  const navigation =
    useNavigation<NativeStackNavigationProp<CustomerStackParamList>>();

  const confirmRemove = (v: Vehicle) =>
    Alert.alert(`Remove ${v.registration}?`, 'Past jobs for this vehicle stay in your activity.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          remove(v.id).catch(err =>
            Alert.alert(
              "Couldn't remove it",
              err instanceof ServerError ? err.message : 'Please try again.',
            ),
          ),
      },
    ]);
  const fullName = account?.name ?? `${customer.firstName} ${customer.lastName}`;
  const phone = customer.mpesaPhone || 'Not set';
  const email = customer.email || 'Not set';

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
          {!!customer.location && <Text style={styles.meta}>{customer.location}</Text>}
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle>My vehicles</SectionTitle>
        <SettingsList>
          {(vehicles ?? []).map(v => (
            <SettingsRow
              key={v.id}
              Icon={Car}
              label={vehicleName(v)}
              value={v.registration}
              onPress={() => confirmRemove(v)}
            />
          ))}
          <SettingsRow
            Icon={Plus}
            label="Add a vehicle"
            onPress={() => navigation.navigate('AddVehicle')}
          />
        </SettingsList>
      </View>

      <View style={styles.section}>
        <SectionTitle>Saved places</SectionTitle>
        <SettingsList>
          <SettingsRow Icon={House} label="Home" value={home?.address ?? 'Save it when you book'} />
          <SettingsRow Icon={Briefcase} label="Work" value={work?.address ?? 'Save it when you book'} />
        </SettingsList>
      </View>

      <View style={styles.section}>
        <SectionTitle>Payment & contact</SectionTitle>
        <SettingsList>
          <SettingsRow
            Icon={Smartphone}
            label="M-Pesa number"
            value={phone}
            onPress={comingSoon('Change M-Pesa number')}
          />
          <SettingsRow Icon={Mail} label="Email" value={email} />
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
    marginTop: 28,
  },
});
