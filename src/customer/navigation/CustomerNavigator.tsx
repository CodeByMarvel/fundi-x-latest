import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RequestFlowScreen } from '../request/RequestFlowScreen';
import { RequestSubmittedScreen } from '../request/RequestSubmittedScreen';
import { CustomerTabs } from './CustomerTabs';

export type CustomerStackParamList = {
  Tabs: undefined;
  RequestFlow: undefined;
  RequestSubmitted: undefined;
};

const Stack = createNativeStackNavigator<CustomerStackParamList>();

/**
 * The customer side: the tab bar, plus full-screen flows (like requesting
 * help) that open on top of it.
 */
export function CustomerNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={CustomerTabs} />
      <Stack.Screen
        name="RequestFlow"
        component={RequestFlowScreen}
        options={{ gestureEnabled: false, animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="RequestSubmitted"
        component={RequestSubmittedScreen}
        options={{ gestureEnabled: false, animation: 'fade' }}
      />
    </Stack.Navigator>
  );
}
