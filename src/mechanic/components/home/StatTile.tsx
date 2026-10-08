import { LucideIcon } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../shared/theme/colors';

type Props = {
  label: string;
  value: string;
  Icon: LucideIcon;
};

export function StatTile({ label, value, Icon }: Props) {
  return (
    <View style={styles.tile}>
      <Icon color={colors.primary} size={18} />
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
    gap: 4,
  },
  value: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textDark,
    marginTop: 4,
  },
  label: {
    fontSize: 12,
    color: colors.textGrey,
  },
});
