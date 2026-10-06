/**
 * FundiX1
 *
 * @format
 */

import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RoleProvider } from './src/app/RoleContext';
import { RootNavigator } from './src/app/RootNavigator';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <RoleProvider>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </RoleProvider>
    </SafeAreaProvider>
  );
}

export default App;
