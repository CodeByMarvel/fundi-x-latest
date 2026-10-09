import { StyleSheet, Text, View } from 'react-native';
import { formatKes } from '../../domain/money';
import { quoteItemKindLabel, sumItems } from '../../domain/quotes/quotes';
import { QuoteItem } from '../../domain/quotes/types';
import { colors } from '../theme/colors';

type Props = {
  items: Pick<
    QuoteItem,
    'id' | 'kind' | 'description' | 'quantity' | 'unitPrice' | 'total'
  >[];
  /** Label for the total row. */
  totalLabel?: string;
};

/** Line items with their prices and a total, as on a quote or receipt. */
export function QuoteItemsList({ items, totalLabel = 'Total' }: Props) {
  return (
    <View style={styles.list}>
      {items.map(item => (
        <View key={item.id} style={styles.row}>
          <View style={styles.body}>
            <Text style={styles.description}>{item.description}</Text>
            <Text style={styles.meta}>
              {quoteItemKindLabel(item.kind)}
              {item.quantity > 1 &&
                ` · ${item.quantity} × ${formatKes(item.unitPrice)}`}
            </Text>
          </View>
          <Text style={styles.amount}>{formatKes(item.total)}</Text>
        </View>
      ))}
      <View style={[styles.row, styles.totalRow]}>
        <Text style={styles.totalLabel}>{totalLabel}</Text>
        <Text style={styles.total}>{formatKes(sumItems(items))}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  body: {
    flex: 1,
  },
  description: {
    fontSize: 15,
    color: colors.textDark,
  },
  meta: {
    fontSize: 13,
    color: colors.textGrey,
    marginTop: 1,
  },
  amount: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textDark,
  },
  totalRow: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    alignItems: 'center',
  },
  totalLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textDark,
  },
  total: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textDark,
  },
});
