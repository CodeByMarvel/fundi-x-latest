import { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../shared/theme/colors';

type Props = {
  label: string;
  Icon: LucideIcon;
  onPress?: () => void;
};

export function ProviderTypeCard({ label, Icon, onPress }: Props) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={styles.iconWrap}>
        <Icon color={colors.primary} size={24} />
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  pressed: {
    backgroundColor: colors.primarySurface,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySurface,
    marginBottom: 12,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textDark,
  },
});
