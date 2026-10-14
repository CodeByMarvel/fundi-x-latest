/**
 * Fundi-X
 *
 * @format
 */

import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RoleProvider } from './src/app/RoleContext';
import { AuthProvider } from './src/auth/AuthContext';
import { RootNavigator } from './src/app/RootNavigator';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <AuthProvider>
        <RoleProvider>
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        </RoleProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export default App;
