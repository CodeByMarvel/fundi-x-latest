import { ChevronRight, LucideIcon } from 'lucide-react-native';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

/** A grouped list of rows, as on account/settings screens. */
export function SettingsList({ children }: { children: ReactNode }) {
  return <View style={styles.list}>{children}</View>;
}

type RowProps = {
  Icon: LucideIcon;
  label: string;
  value?: string;
  onPress?: () => void;
  /** Replaces the chevron, e.g. with a switch. */
  right?: ReactNode;
};

export function SettingsRow({ Icon, label, value, onPress, right }: RowProps) {
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <Icon color={colors.textGrey} size={20} />
      <View style={styles.body}>
        <Text style={styles.label}>{label}</Text>
        {value && <Text style={styles.value}>{value}</Text>}
      </View>
      {right ??
        (onPress && <ChevronRight color={colors.textLight} size={18} />)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  body: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    color: colors.textDark,
  },
  value: {
    fontSize: 13,
    color: colors.textGrey,
    marginTop: 2,
  },
});
