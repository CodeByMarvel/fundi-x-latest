import { Pressable, StyleSheet, Text } from 'react-native';
import { useRole } from '../../app/RoleContext';
import { colors } from '../theme/colors';

/**
 * Temporary dev helper for jumping between the customer and mechanic sides.
 * Remove once login sets the role.
 */
export function SwitchRoleButton() {
  const { role, setRole } = useRole();
  const other = role === 'customer' ? 'mechanic' : 'customer';

  return (
    <Pressable style={styles.button} onPress={() => setRole(other)}>
      <Text style={styles.label}>Switch to {other} side (dev)</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: colors.primarySurface,
  },
  label: {
    color: colors.primary,
    fontWeight: '600',
  },
});
