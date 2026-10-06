import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ClipboardList, House, User, Wrench } from 'lucide-react-native';
import { useTabScreenOptions } from '../../shared/navigation/tabScreenOptions';
import { AccountScreen } from '../screens/AccountScreen';
import { ActivityScreen } from '../screens/ActivityScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { ServicesScreen } from '../screens/ServicesScreen';

export type CustomerTabParamList = {
  Home: undefined;
  Services: undefined;
  Activity: undefined;
  Account: undefined;
};

const Tab = createBottomTabNavigator<CustomerTabParamList>();

const TAB_ICONS = {
  Home: House,
  Services: Wrench,
  Activity: ClipboardList,
  Account: User,
};

export function CustomerTabs() {
  const screenOptions = useTabScreenOptions(TAB_ICONS, { floating: true });

  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Services" component={ServicesScreen} />
      <Tab.Screen name="Activity" component={ActivityScreen} />
      <Tab.Screen name="Account" component={AccountScreen} />
    </Tab.Navigator>
  );
}
