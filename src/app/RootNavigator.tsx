import { CustomerNavigator } from '../customer/navigation/CustomerNavigator';
import { MechanicNavigator } from '../mechanic/navigation/MechanicNavigator';
import { useRole } from './RoleContext';

/**
 * Picks which side of the app to show based on the signed-in user's role.
 */
export function RootNavigator() {
  const { role } = useRole();
  return role === 'mechanic' ? <MechanicNavigator /> : <CustomerNavigator />;
}
