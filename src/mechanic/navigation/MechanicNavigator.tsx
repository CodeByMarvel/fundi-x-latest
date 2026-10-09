import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MechanicJobScreen } from '../jobs/MechanicJobScreen';
import { QuoteBuilderScreen } from '../jobs/QuoteBuilderScreen';
import { MechanicTabs } from './MechanicTabs';

export type MechanicStackParamList = {
  Tabs: undefined;
  MechanicJob: { jobId: string };
  /** base: the main repair quote. additional: extra work found on site. */
  QuoteBuilder: { jobId: string; mode: 'base' | 'additional' };
};

const Stack = createNativeStackNavigator<MechanicStackParamList>();

/** The mechanic side: the tab bar, plus job screens that open on top. */
export function MechanicNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={MechanicTabs} />
      <Stack.Screen name="MechanicJob" component={MechanicJobScreen} />
      <Stack.Screen
        name="QuoteBuilder"
        component={QuoteBuilderScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
    </Stack.Navigator>
  );
}
