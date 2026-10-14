import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { PhoneScreen } from '../auth/screens/PhoneScreen';
import { ProviderProfileScreen } from '../auth/screens/ProviderProfileScreen';
import { SignInScreen } from '../auth/screens/SignInScreen';
import { CustomerNavigator } from '../customer/navigation/CustomerNavigator';
import { MechanicNavigator } from '../mechanic/navigation/MechanicNavigator';
import { colors } from '../shared/theme/colors';
import { useRole } from './RoleContext';

/**
 * Sign-in first, then what the account still needs (phone number, then a
 * mechanic's profile), then the side of the app that matches the account.
 * Demo mode (development only) skips sign-in and keeps the role switcher.
 */
export function RootNavigator() {
  const { state } = useAuth();
  const { role, setRole } = useRole();

  const accountRole =
    state.status === 'signedIn'
      ? state.account.role === 'provider'
        ? 'mechanic'
        : 'customer'
      : null;
  useEffect(() => {
    if (accountRole) {
      setRole(accountRole);
    }
  }, [accountRole, setRole]);

  switch (state.status) {
    case 'loading':
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      );
    case 'signedOut':
      return <SignInScreen />;
    case 'signedIn':
      if (state.account.nextStep === 'add_phone') {
        return <PhoneScreen />;
      }
      if (state.account.nextStep === 'provider_profile') {
        return <ProviderProfileScreen />;
      }
      return accountRole === 'mechanic' ? (
        <MechanicNavigator />
      ) : (
        <CustomerNavigator />
      );
    case 'demo':
      return role === 'mechanic' ? <MechanicNavigator /> : <CustomerNavigator />;
  }
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
