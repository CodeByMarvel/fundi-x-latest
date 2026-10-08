import { MapPin, Wrench } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { vehicleName } from '../../../customer/data/mockVehicles';
import { getCategory } from '../../../customer/request/data/categories';
import { Job } from '../../../domain/jobs/types';
import { colors } from '../../../shared/theme/colors';
import { providerStatusText } from '../../jobs/providerJobPresentation';

/** The job the provider is working on right now. */
export function CurrentJobCard({ job }: { job: Job }) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Wrench color={colors.primary} size={20} />
        </View>
        <View style={styles.body}>
          <Text style={styles.category}>
            {getCategory(job.categoryId)?.label}
          </Text>
          <Text style={styles.vehicle}>
            {vehicleName(job.vehicle)} · {job.vehicle.registration}
          </Text>
        </View>
      </View>
      <Text style={styles.status}>{providerStatusText(job.status)}</Text>
      <View style={styles.location}>
        <MapPin color={colors.textGrey} size={14} />
        <Text style={styles.address} numberOfLines={1}>
          {job.location.address}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  category: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textDark,
  },
  vehicle: {
    fontSize: 14,
    color: colors.textGrey,
    marginTop: 2,
  },
  status: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  location: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  address: {
    flexShrink: 1,
    fontSize: 14,
    color: colors.textGrey,
  },
});
