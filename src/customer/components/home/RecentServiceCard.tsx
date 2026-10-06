import { Car, ChevronRight } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../shared/theme/colors';
import { RecentService } from '../../data/mockHome';

type Props = {
  service: RecentService;
  onPress?: () => void;
};

export function RecentServiceCard({ service, onPress }: Props) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.iconWrap}>
        <Car color={colors.primary} size={22} />
      </View>
      <View style={styles.body}>
        <Text style={styles.car}>{service.car}</Text>
        <Text style={styles.detail}>
          {service.service} · {service.date}
        </Text>
      </View>
      <Text style={styles.price}>{service.price}</Text>
      <ChevronRight color={colors.textLight} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  iconWrap: {
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
  car: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textDark,
  },
  detail: {
    fontSize: 13,
    color: colors.textGrey,
    marginTop: 2,
  },
  price: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textDark,
  },
});
