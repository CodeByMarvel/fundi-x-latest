import { Building2, MapPin, Star, Wrench } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../shared/theme/colors';
import { Provider } from '../../data/mockHome';

type Props = {
  provider: Provider;
  onPress?: () => void;
};

export function ProviderCard({ provider, onPress }: Props) {
  const Icon = provider.type === 'garage' ? Building2 : Wrench;

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.avatar}>
        <Icon color={colors.primary} size={22} />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {provider.name}
      </Text>
      <Text style={styles.specialty} numberOfLines={1}>
        {provider.specialty}
      </Text>
      <View style={styles.metaRow}>
        <Star color={colors.warning} fill={colors.warning} size={14} />
        <Text style={styles.meta}>{provider.rating.toFixed(1)}</Text>
        <MapPin color={colors.textLight} size={14} />
        <Text style={styles.meta}>{provider.distanceKm} km</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 170,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySurface,
    marginBottom: 10,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textDark,
  },
  specialty: {
    fontSize: 13,
    color: colors.textGrey,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
  },
  meta: {
    fontSize: 13,
    color: colors.textGrey,
    marginRight: 6,
  },
});
