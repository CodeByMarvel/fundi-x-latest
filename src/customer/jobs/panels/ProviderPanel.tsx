import { Phone, Star } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useProvider } from '../../../data/useJob';
import { Job } from '../../../domain/jobs/types';
import { Avatar } from '../../../shared/components/Avatar';
import { Card } from '../../../shared/components/Card';
import { colors } from '../../../shared/theme/colors';

/** Who's coming: name, rating, specialty and a call button. */
export function ProviderPanel({ job }: { job: Job }) {
  const provider = useProvider(job.providerId);
  if (!provider) {
    return null;
  }

  return (
    <Card title="Your fundi">
      <View style={styles.row}>
        <Avatar name={provider.name} />
        <View style={styles.body}>
          <Text style={styles.name}>{provider.name}</Text>
          <Text style={styles.specialty}>{provider.specialty}</Text>
          <View style={styles.rating}>
            <Star color={colors.warning} fill={colors.warning} size={14} />
            <Text style={styles.ratingText}>
              {provider.rating.toFixed(1)} ({provider.ratingCount} jobs)
            </Text>
          </View>
        </View>
        <Pressable
          style={styles.call}
          onPress={() => Linking.openURL(`tel:+${provider.phone}`)}
          accessibilityLabel={`Call ${provider.name}`}
        >
          <Phone color={colors.primary} size={20} />
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textDark,
  },
  specialty: {
    fontSize: 14,
    color: colors.textGrey,
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    fontSize: 13,
    color: colors.textGrey,
  },
  call: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySurface,
  },
});
