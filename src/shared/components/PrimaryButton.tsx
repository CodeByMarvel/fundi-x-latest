import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../theme/colors';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Shows a spinner instead of the label, and blocks presses. */
  loading?: boolean;
  /**
   * `outline` is for the second choice next to a primary one (e.g. Reject).
   * `ghost` is a quieter text-only button, e.g. for "Skip".
   */
  variant?: 'primary' | 'outline' | 'ghost';
};

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
}: Props) {
  const primary = variant === 'primary';
  const blocked = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        pressed && primary && styles.primaryPressed,
        pressed && !primary && styles.quietPressed,
        disabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.surface : colors.primary} />
      ) : (
        <Text
          style={[
            styles.label,
            variant === 'outline' && styles.outlineLabel,
            variant === 'ghost' && styles.ghostLabel,
          ]}
        >
          {label}
        </Text>
      )}
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
  outline: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.divider,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  quietPressed: {
    backgroundColor: colors.background,
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.surface,
  },
  outlineLabel: {
    color: colors.textDark,
  },
  ghostLabel: {
    color: colors.textGrey,
  },
});
