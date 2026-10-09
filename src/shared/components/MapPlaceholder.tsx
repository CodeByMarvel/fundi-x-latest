import { MapPin, Navigation } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

type Props = {
  address: string;
  /** e.g. "6 min away" */
  caption?: string;
};

/** Stands in for a live map until maps are integrated. */
export function MapPlaceholder({ address, caption }: Props) {
  return (
    <View style={styles.map}>
      {/* A few faint "roads" so it reads as a map at a glance. */}
      <View style={[styles.road, styles.roadA]} />
      <View style={[styles.road, styles.roadB]} />
      <View style={[styles.road, styles.roadC]} />

      <View style={[styles.marker, styles.fundi]}>
        <Navigation color={colors.surface} size={16} fill={colors.surface} />
      </View>
      <View style={[styles.marker, styles.destination]}>
        <MapPin color={colors.surface} size={16} />
      </View>

      <View style={styles.label}>
        <Text style={styles.address} numberOfLines={1}>
          {address}
        </Text>
        {caption && <Text style={styles.caption}>{caption}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    height: 160,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#EEF2EC',
  },
  road: {
    position: 'absolute',
    backgroundColor: colors.surface,
  },
  roadA: {
    left: 0,
    right: 0,
    top: 54,
    height: 10,
  },
  roadB: {
    top: 0,
    bottom: 0,
    left: '38%',
    width: 10,
  },
  roadC: {
    left: '55%',
    right: 0,
    top: 110,
    height: 8,
  },
  marker: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.surface,
  },
  fundi: {
    top: 42,
    left: '18%',
    backgroundColor: colors.primary,
  },
  destination: {
    top: 96,
    left: '70%',
    backgroundColor: colors.textDark,
  },
  label: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  address: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textDark,
  },
  caption: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
});
