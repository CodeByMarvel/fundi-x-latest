import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Briefcase, House, User, Wallet } from 'lucide-react-native';
import { useTabScreenOptions } from '../../shared/navigation/tabScreenOptions';
import { AccountScreen } from '../screens/AccountScreen';
import { EarningsScreen } from '../screens/EarningsScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { JobsScreen } from '../screens/JobsScreen';

export type MechanicTabParamList = {
  Home: undefined;
  Jobs: undefined;
  Earnings: undefined;
  Account: undefined;
};

const Tab = createBottomTabNavigator<MechanicTabParamList>();

const TAB_ICONS = {
  Home: House,
  Jobs: Briefcase,
  Earnings: Wallet,
  Account: User,
};

export function MechanicTabs() {
  const screenOptions = useTabScreenOptions(TAB_ICONS);

  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Jobs" component={JobsScreen} />
      <Tab.Screen name="Earnings" component={EarningsScreen} />
      <Tab.Screen name="Account" component={AccountScreen} />
    </Tab.Navigator>
  );
}
