import { StyleSheet, Text } from 'react-native';
import { colors } from '../theme/colors';

export function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.title}>{children}</Text>;
}

const styles = StyleSheet.create({
  title: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textGrey,
    marginBottom: 12,
  },
});
