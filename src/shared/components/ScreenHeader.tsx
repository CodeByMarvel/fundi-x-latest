import { ChevronLeft } from 'lucide-react-native';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

type Props = {
  title: string;
  onBack: () => void;
  /** Optional button on the right. */
  right?: ReactNode;
};

/** Top bar for screens pushed on top of the tabs. */
export function ScreenHeader({ title, onBack, right }: Props) {
  return (
    <View style={styles.bar}>
      <Pressable
        style={styles.iconButton}
        onPress={onBack}
        accessibilityLabel="Back"
        hitSlop={8}
      >
        <ChevronLeft color={colors.textDark} size={24} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.iconButton}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: colors.textGrey,
  },
});
