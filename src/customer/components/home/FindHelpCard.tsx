import { ArrowRight, Wrench } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../shared/theme/colors';

export function FindHelpCard({ onPress }: { onPress?: () => void }) {
  return (
    <View>
      <Text style={styles.question}>What does your car need?</Text>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        onPress={onPress}
      >
        <View style={styles.iconWrap}>
          <Wrench color={colors.primary} size={20} />
        </View>
        <Text style={styles.label}>Find help for my car</Text>
        <ArrowRight color={colors.surface} size={20} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  question: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textDark,
    marginBottom: 12,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.primary,
  },
  pressed: {
    backgroundColor: colors.primaryLight,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  label: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.surface,
  },
});
