import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../theme/colors';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** `ghost` is a quieter text-only button, e.g. for "Skip". */
  variant?: 'primary' | 'ghost';
};

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  variant = 'primary',
}: Props) {
  const ghost = variant === 'ghost';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        ghost ? styles.ghost : styles.primary,
        pressed && !ghost && styles.primaryPressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, ghost && styles.ghostLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.primary,
  },
  primaryPressed: {
    backgroundColor: colors.primaryLight,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.surface,
  },
  ghostLabel: {
    color: colors.textGrey,
  },
});
