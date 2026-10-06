import { Check } from 'lucide-react-native';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../shared/theme/colors';

type Props = {
  label: string;
  description?: string;
  selected?: boolean;
  /** Shows a checkbox, for questions where several answers can be picked. */
  multi?: boolean;
  /** Icon or marker shown on the left. */
  leading?: ReactNode;
  onPress: () => void;
};

export function OptionCard({
  label,
  description,
  selected = false,
  multi = false,
  leading,
  onPress,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [
        styles.card,
        selected && styles.selected,
        pressed && !selected && styles.pressed,
      ]}
    >
      {leading && <View style={styles.leading}>{leading}</View>}
      <View style={styles.body}>
        <Text style={styles.label}>{label}</Text>
        {description && <Text style={styles.description}>{description}</Text>}
      </View>
      {multi && (
        <View style={[styles.checkbox, selected && styles.checkboxOn]}>
          {selected && <Check color={colors.surface} size={14} />}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.divider,
  },
  selected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySurface,
  },
  pressed: {
    backgroundColor: colors.background,
  },
  leading: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySurface,
  },
  body: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textDark,
  },
  description: {
    fontSize: 14,
    lineHeight: 19,
    color: colors.textGrey,
    marginTop: 3,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.inactive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
});
