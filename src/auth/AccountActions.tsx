import { ArrowLeft, LogOut, Trash2 } from 'lucide-react-native';
import { Alert, StyleSheet, View } from 'react-native';
import { SectionTitle } from '../shared/components/SectionTitle';
import { SettingsList, SettingsRow } from '../shared/components/SettingsList';
import { SwitchRoleButton } from '../shared/components/SwitchRoleButton';
import { ServerError } from './api';
import { useAuth } from './AuthContext';

/**
 * The bottom of both account screens. Signed in: sign out, and delete the
 * account (both app stores require it). Demo mode: back to sign-in, and
 * the role switcher.
 */
export function AccountActions() {
  const { state, signOut, deleteAccount } = useAuth();

  if (state.status === 'demo') {
    return (
      <View style={styles.section}>
        <SectionTitle>Development</SectionTitle>
        <SettingsList>
          <SettingsRow Icon={ArrowLeft} label="Back to sign-in" onPress={signOut} />
        </SettingsList>
        <View style={styles.dev}>
          <SwitchRoleButton />
        </View>
      </View>
    );
  }

  const confirmDelete = () =>
    Alert.alert(
      'Delete your account?',
      'Your name, email and phone number are removed and you are signed out. Past jobs and payments stay in our records, as the law requires.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteAccount().catch(err =>
              Alert.alert(
                "Couldn't delete your account",
                err instanceof ServerError ? err.message : 'Please try again.',
              ),
            ),
        },
      ],
    );

  return (
    <View style={styles.section}>
      <SectionTitle>Account</SectionTitle>
      <SettingsList>
        <SettingsRow Icon={LogOut} label="Sign out" onPress={signOut} />
        <SettingsRow Icon={Trash2} label="Delete account" onPress={confirmDelete} />
      </SettingsList>
    </View>
  );
}

/** The signed-in account, or null in demo mode. */
export function useSignedInAccount() {
  const { state } = useAuth();
  return state.status === 'signedIn' ? state.account : null;
}

const styles = StyleSheet.create({
  section: {
    marginTop: 28,
  },
  dev: {
    marginTop: 16,
    alignItems: 'center',
  },
});
