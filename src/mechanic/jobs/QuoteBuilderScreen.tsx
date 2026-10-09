import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Minus, Plus, Sparkles, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getCategory } from '../../customer/request/data/categories';
import { jobRepository } from '../../data/backend';
import { useJob, useQuote } from '../../data/useJob';
import { formatKes, kes } from '../../domain/money';
import {
  QUOTE_ITEM_KINDS,
  QuoteValidationError,
  sampleQuoteItems,
  validateQuoteItems,
} from '../../domain/quotes/quotes';
import { QuoteItemInput, QuoteItemKind } from '../../domain/quotes/types';
import { Card, textStyles } from '../../shared/components/Card';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { ScreenHeader } from '../../shared/components/ScreenHeader';
import { TextField } from '../../shared/components/TextField';
import { useAsyncAction } from '../../shared/hooks/useAsyncAction';
import { colors } from '../../shared/theme/colors';
import { CURRENT_PROVIDER_ID } from '../data/mockMechanic';
import type { MechanicStackParamList } from '../navigation/MechanicNavigator';

type Props = NativeStackScreenProps<MechanicStackParamList, 'QuoteBuilder'>;

/**
 * One line while it's being edited. Prices are typed as whole shillings
 * (text), and only turned into cents when the quote is sent.
 */
type DraftItem = {
  key: string;
  kind: QuoteItemKind;
  description: string;
  quantity: number;
  shillings: string;
};

let nextKey = 1;

function toDraft(item: QuoteItemInput): DraftItem {
  return {
    key: String(nextKey++),
    kind: item.kind,
    description: item.description,
    quantity: item.quantity,
    shillings: String(item.unitPrice / 100),
  };
}

function toInput(item: DraftItem): QuoteItemInput {
  const shillings = Number.parseInt(item.shillings.replace(/\D/g, ''), 10);
  return {
    kind: item.kind,
    description: item.description,
    quantity: item.quantity,
    unitPrice: Number.isNaN(shillings) ? 0 : kes(shillings),
  };
}

export function QuoteBuilderScreen({ navigation, route }: Props) {
  const { top, bottom } = useSafeAreaInsets();
  const job = useJob(route.params.jobId);
  // When revising, start from the withdrawn quote.
  const previous = useQuote(job?.quoteId);
  const [items, setItems] = useState<DraftItem[]>(() =>
    (previous?.items ?? sampleQuoteItems('').slice(0, 1)).map(toDraft),
  );
  const [note, setNote] = useState(previous?.note ?? '');
  const [error, setError] = useState<string>();
  const { pending, run } = useAsyncAction<'send'>();

  if (!job) {
    return null;
  }
  // The customer may have cancelled while the provider was typing.
  const canSend = job.status === 'DIAGNOSING';
  const inputs = items.map(toInput);
  const total = inputs.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

  const update = (key: string, patch: Partial<DraftItem>) => {
    setError(undefined);
    setItems(list => list.map(i => (i.key === key ? { ...i, ...patch } : i)));
  };

  const send = () => {
    try {
      // Same check the backend runs, done first for an instant message.
      validateQuoteItems(inputs);
    } catch (e) {
      setError(e instanceof QuoteValidationError ? e.message : String(e));
      return;
    }
    run('send', async () => {
      await jobRepository.sendQuote(job.id, CURRENT_PROVIDER_ID, inputs, note);
      navigation.goBack();
    });
  };

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.screen, { paddingTop: top }]}
    >
      <ScreenHeader
        title={previous ? 'Update quote' : 'New quote'}
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>{getCategory(job.categoryId)?.label}</Text>
        <Text style={textStyles.secondary}>
          List each charge. The call-out and inspection fees are what the
          customer pays if they decline the rest.
        </Text>

        <Pressable
          style={styles.suggest}
          onPress={() =>
            setItems(sampleQuoteItems(job.categoryId).map(toDraft))
          }
        >
          <Sparkles color={colors.primary} size={16} />
          <Text style={styles.suggestText}>
            Use a typical quote for this job
          </Text>
        </Pressable>

        {items.map((item, index) => (
          <Card
            key={item.key}
            title={`Item ${index + 1}`}
            aside={
              <Pressable
                onPress={() =>
                  setItems(list => list.filter(i => i.key !== item.key))
                }
                hitSlop={8}
                accessibilityLabel="Remove item"
              >
                <Trash2 color={colors.textGrey} size={18} />
              </Pressable>
            }
          >
            <View style={styles.kinds}>
              {QUOTE_ITEM_KINDS.map(({ kind, label }) => (
                <Pressable
                  key={kind}
                  style={[styles.kind, item.kind === kind && styles.kindActive]}
                  onPress={() => update(item.key, { kind })}
                >
                  <Text
                    style={[
                      styles.kindText,
                      item.kind === kind && styles.kindTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextField
              value={item.description}
              onChangeText={description => update(item.key, { description })}
              placeholder="Description, e.g. Front brake pads"
            />
            <View style={styles.numbers}>
              <View style={styles.stepper}>
                <Pressable
                  style={styles.stepButton}
                  onPress={() =>
                    update(item.key, {
                      quantity: Math.max(1, item.quantity - 1),
                    })
                  }
                  accessibilityLabel="Less"
                >
                  <Minus color={colors.textDark} size={16} />
                </Pressable>
                <Text style={styles.quantity}>{item.quantity}</Text>
                <Pressable
                  style={styles.stepButton}
                  onPress={() =>
                    update(item.key, { quantity: item.quantity + 1 })
                  }
                  accessibilityLabel="More"
                >
                  <Plus color={colors.textDark} size={16} />
                </Pressable>
              </View>
              <View style={styles.price}>
                <TextField
                  value={item.shillings}
                  onChangeText={shillings => update(item.key, { shillings })}
                  placeholder="Price (KSh)"
                  keyboardType="number-pad"
                />
              </View>
            </View>
          </Card>
        ))}

        <PrimaryButton
          variant="outline"
          label="Add item"
          onPress={() =>
            setItems(list => [
              ...list,
              toDraft({
                kind: 'LABOUR',
                description: '',
                quantity: 1,
                unitPrice: 0,
              }),
            ])
          }
        />

        <TextField
          label="Note for the customer (optional)"
          multiline
          value={note}
          onChangeText={setNote}
          placeholder="e.g. The pads are worn down to the metal"
        />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottom + 12 }]}>
        {!canSend && (
          <Text style={styles.error}>
            This job has moved on and can't take a quote right now.
          </Text>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.total}>{formatKes(total)}</Text>
        </View>
        <PrimaryButton
          label="Send quote to customer"
          onPress={send}
          loading={pending === 'send'}
          disabled={!canSend}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    gap: 14,
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textDark,
  },
  suggest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.primarySurface,
  },
  suggestText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  kinds: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  kind: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  kindActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySurface,
  },
  kindText: {
    fontSize: 13,
    color: colors.textGrey,
  },
  kindTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  numbers: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  quantity: {
    minWidth: 20,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: colors.textDark,
  },
  price: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textGrey,
  },
  total: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textDark,
  },
  error: {
    fontSize: 14,
    color: colors.error,
  },
});
