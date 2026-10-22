import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { JobTrackingScreen } from '../jobs/JobTrackingScreen';
import { RequestFlowScreen } from '../request/RequestFlowScreen';
import type { RequestType } from '../request/types';
import { AddVehicleScreen } from '../screens/AddVehicleScreen';
import { CustomerTabs } from './CustomerTabs';

export type CustomerStackParamList = {
  Tabs: undefined;
  /** Optionally start with the job already chosen, e.g. from Services. */
  RequestFlow: { requestType: RequestType; categoryId: string } | undefined;
  JobTracking: { jobId: string };
  AddVehicle: undefined;
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
      <Stack.Screen name="JobTracking" component={JobTrackingScreen} />
      <Stack.Screen
        name="AddVehicle"
        component={AddVehicleScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
    </Stack.Navigator>
  );
}
