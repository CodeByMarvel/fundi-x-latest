import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export type PillTone = 'active' | 'success' | 'stopped' | 'warning';

const TONES: Record<PillTone, { background: string; text: string }> = {
  active: { background: colors.primarySurface, text: colors.primary },
  success: { background: '#E8F8EE', text: '#15803D' },
  stopped: { background: colors.divider, text: colors.textGrey },
  warning: { background: '#FEF3C7', text: '#B45309' },
};

export function StatusPill({ label, tone }: { label: string; tone: PillTone }) {
  const { background, text } = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <Text style={[styles.label, { color: text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
  },
});
