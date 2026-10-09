import { Star } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';

type Props = {
  value: number;
  /** When given, the stars can be tapped. */
  onChange?: (stars: number) => void;
  size?: number;
};

export function StarRating({ value, onChange, size = 20 }: Props) {
  return (
    <View style={styles.row} accessibilityLabel={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(star => {
        const filled = star <= Math.round(value);
        const icon = (
          <Star
            size={size}
            color={filled ? colors.warning : colors.inactive}
            fill={filled ? colors.warning : 'transparent'}
          />
        );
        return onChange ? (
          <Pressable
            key={star}
            onPress={() => onChange(star)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${star} star${star > 1 ? 's' : ''}`}
          >
            {icon}
          </Pressable>
        ) : (
          <View key={star}>{icon}</View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
  },
});
