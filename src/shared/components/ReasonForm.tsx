import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { Card } from './Card';
import { PrimaryButton } from './PrimaryButton';
import { TextField } from './TextField';

type Props = {
  title: string;
  placeholder: string;
  submitLabel: string;
  /** One-tap answers that fill in the text box. */
  suggestions?: string[];
  /** Whether the text must be filled in before submitting. */
  required?: boolean;
  loading?: boolean;
  onSubmit: (text: string) => void;
  onBack: () => void;
};

/** Asks for a short explanation, e.g. why a job is being cancelled. */
export function ReasonForm({
  title,
  placeholder,
  submitLabel,
  suggestions = [],
  required = true,
  loading = false,
  onSubmit,
  onBack,
}: Props) {
  const [text, setText] = useState('');

  return (
    <Card title={title}>
      {suggestions.length > 0 && (
        <View style={styles.chips}>
          {suggestions.map(s => (
            <Pressable
              key={s}
              style={[styles.chip, text === s && styles.chipActive]}
              onPress={() => setText(s)}
            >
              <Text
                style={[styles.chipText, text === s && styles.chipTextActive]}
              >
                {s}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <TextField
        multiline
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
      />
      <PrimaryButton
        label={submitLabel}
        onPress={() => onSubmit(text)}
        disabled={required && !text.trim()}
        loading={loading}
      />
      <PrimaryButton
        variant="ghost"
        label="Back"
        onPress={onBack}
        disabled={loading}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySurface,
  },
  chipText: {
    fontSize: 14,
    color: colors.textDark,
  },
  chipTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
});
