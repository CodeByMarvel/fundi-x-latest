import { CustomerNavigator } from '../customer/navigation/CustomerNavigator';
import { MechanicTabs } from '../mechanic/navigation/MechanicTabs';
import { useRole } from './RoleContext';

/**
 * Picks which side of the app to show based on the signed-in user's role.
 */
export function RootNavigator() {
  const { role } = useRole();
  return role === 'mechanic' ? <MechanicTabs /> : <CustomerNavigator />;
}
