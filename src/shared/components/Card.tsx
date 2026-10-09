import { ReactNode } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '../theme/colors';

type Props = {
  /** Small uppercase heading inside the card. */
  title?: string;
  /** Something on the right of the title, e.g. a status pill. */
  aside?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** The white rounded panel used for most content blocks. */
export function Card({ title, aside, children, style }: Props) {
  return (
    <View style={[styles.card, style]}>
      {(title || aside) && (
        <View style={styles.header}>
          {title && <Text style={styles.title}>{title}</Text>}
          {aside}
        </View>
      )}
      {children}
    </View>
  );
}

/** A label above a value, for detail lists inside a card. */
export function Detail({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      {children}
    </View>
  );
}

export const textStyles = StyleSheet.create({
  primary: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textDark,
  },
  secondary: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textGrey,
  },
  quote: {
    fontSize: 15,
    lineHeight: 21,
    fontStyle: 'italic',
    color: colors.textDark,
  },
});

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textGrey,
  },
  detail: {
    gap: 2,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textLight,
    marginBottom: 2,
  },
});
