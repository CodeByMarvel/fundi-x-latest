import { Clock, MapPin } from 'lucide-react-native';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { vehicleName } from '../../../customer/data/mockVehicles';
import { getCategory } from '../../../customer/request/data/categories';
import { Job } from '../../../domain/jobs/types';
import { useNow } from '../../../shared/hooks/useNow';
import { colors } from '../../../shared/theme/colors';
import {
  drivabilityView,
  symptomLabels,
  urgencyText,
} from '../../jobs/providerJobPresentation';

type Props = {
  job: Job;
  distanceKm: number;
  /** Which answer is being sent, if any. */
  responding: 'accept' | 'decline' | null;
  onAccept: () => void;
  onDecline: () => void;
};

/** An incoming job the provider can take or turn down. */
export function JobOfferCard({
  job,
  distanceKm,
  responding,
  onAccept,
  onDecline,
}: Props) {
  const symptoms = symptomLabels(job);
  const drivability = drivabilityView(job.drivability);
  const busy = responding !== null;
  const now = useNow();
  const secondsLeft = job.offerExpiresAt
    ? Math.max(0, Math.ceil((Date.parse(job.offerExpiresAt) - now) / 1000))
    : undefined;

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>New request</Text>
        </View>
        <View style={styles.inline}>
          <Clock color={colors.textGrey} size={14} />
          <Text style={styles.meta}>{urgencyText(job.urgency, job)}</Text>
        </View>
      </View>

      {secondsLeft !== undefined && (
        <Text style={[styles.countdown, secondsLeft <= 10 && styles.urgent]}>
          Respond within {secondsLeft}s
        </Text>
      )}

      <Text style={styles.category}>{getCategory(job.categoryId)?.label}</Text>
      <Text style={styles.vehicle}>
        {vehicleName(job.vehicle)} · {job.vehicle.registration}
      </Text>

      {symptoms.length > 0 && (
        <View style={styles.chips}>
          {symptoms.map(label => (
            <View key={label} style={styles.chip}>
              <Text style={styles.chipText}>{label}</Text>
            </View>
          ))}
        </View>
      )}
      {!!job.description && (
        <Text style={styles.description}>“{job.description}”</Text>
      )}

      <View style={styles.details}>
        <View style={styles.inline}>
          <View style={[styles.dot, { backgroundColor: drivability.color }]} />
          <Text style={styles.detail}>{drivability.label}</Text>
        </View>
        <View style={styles.inline}>
          <MapPin color={colors.textGrey} size={14} />
          <Text style={styles.detail} numberOfLines={1}>
            {job.location.address} · {distanceKm} km away
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, styles.decline, busy && styles.disabled]}
          onPress={onDecline}
          disabled={busy}
          accessibilityRole="button"
        >
          {responding === 'decline' ? (
            <ActivityIndicator color={colors.textGrey} />
          ) : (
            <Text style={styles.declineText}>Decline</Text>
          )}
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.accept,
            pressed && styles.acceptPressed,
            busy && styles.disabled,
          ]}
          onPress={onAccept}
          disabled={busy}
          accessibilityRole="button"
        >
          {responding === 'accept' ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text style={styles.acceptText}>Accept job</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.primarySurface,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  meta: {
    fontSize: 13,
    color: colors.textGrey,
  },
  countdown: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textGrey,
    marginBottom: 6,
  },
  urgent: {
    color: colors.error,
  },
  category: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textDark,
  },
  vehicle: {
    fontSize: 14,
    color: colors.textGrey,
    marginTop: 2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  chipText: {
    fontSize: 13,
    color: colors.textDark,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
    color: colors.textDark,
    marginTop: 10,
  },
  details: {
    gap: 6,
    marginTop: 14,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  detail: {
    flexShrink: 1,
    fontSize: 14,
    color: colors.textGrey,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  decline: {
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  declineText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textGrey,
  },
  accept: {
    flex: 2,
    backgroundColor: colors.primary,
  },
  acceptPressed: {
    backgroundColor: colors.primaryLight,
  },
  acceptText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.surface,
  },
  disabled: {
    opacity: 0.5,
  },
});
