import { ChevronLeft, X } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../shared/theme/colors';

type Props = {
  stage: number;
  stageCount: number;
  onBack: () => void;
  onClose: () => void;
};

export function RequestHeader({ stage, stageCount, onBack, onClose }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Pressable
          style={styles.iconButton}
          onPress={onBack}
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <ChevronLeft color={colors.textDark} size={24} />
        </Pressable>
        <Text style={styles.title}>Requesting help</Text>
        <Pressable
          style={styles.iconButton}
          onPress={onClose}
          accessibilityLabel="Cancel request"
          hitSlop={8}
        >
          <X color={colors.textDark} size={22} />
        </Pressable>
      </View>

      <View
        style={styles.dots}
        accessibilityLabel={`Step ${stage} of ${stageCount}`}
      >
        {Array.from({ length: stageCount }, (_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i < stage && styles.dotDone,
              i === stage - 1 && styles.dotCurrent,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textGrey,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.divider,
  },
  dotDone: {
    backgroundColor: colors.primaryLight,
  },
  dotCurrent: {
    width: 20,
    backgroundColor: colors.primary,
  },
});
