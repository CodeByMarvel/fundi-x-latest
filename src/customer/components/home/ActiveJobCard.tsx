import { ChevronRight } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../shared/theme/colors';

type Props = {
  car: string;
  service: string;
  status: string;
  /** 0 to 1 */
  progress: number;
  onViewJob?: () => void;
};

export function ActiveJobCard({
  car,
  service,
  status,
  progress,
  onViewJob,
}: Props) {
  const percent = `${Math.round(progress * 100)}%` as const;

  return (
    <View style={styles.card}>
      <Text style={styles.car}>{car}</Text>
      <Text style={styles.service}>{service}</Text>
      <Text style={styles.status}>{status}</Text>

      <View style={styles.track}>
        <View style={[styles.fill, { width: percent }]} />
        <View style={[styles.dot, styles.dotStart]} />
        <View style={[styles.dot, styles.dotEnd]} />
      </View>

      <Pressable style={styles.viewJob} onPress={onViewJob}>
        <Text style={styles.viewJobText}>View Job</Text>
        <ChevronRight color={colors.primary} size={18} />
      </Pressable>
    </View>
  );
}

const DOT_SIZE = 12;

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  car: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textDark,
  },
  service: {
    fontSize: 14,
    color: colors.textGrey,
    marginTop: 2,
  },
  status: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 10,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    marginTop: 16,
    marginBottom: 8,
    marginHorizontal: DOT_SIZE / 2,
    justifyContent: 'center',
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  dot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  dotStart: {
    left: -DOT_SIZE / 2,
    backgroundColor: colors.primary,
  },
  dotEnd: {
    right: -DOT_SIZE / 2,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.inactive,
  },
  viewJob: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  viewJobText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },
});
