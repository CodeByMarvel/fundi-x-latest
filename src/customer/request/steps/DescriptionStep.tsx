import { StyleSheet, Text, TextInput } from 'react-native';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { colors } from '../../../shared/theme/colors';
import { StepLayout } from '../components/StepLayout';
import { StepProps } from './stepProps';

export function DescriptionStep({ draft, onChange, onNext }: StepProps) {
  const hasText = draft.description.trim().length > 0;

  return (
    <StepLayout
      title="Anything else we should know?"
      subtitle="Describe the problem in your own words."
      footer={
        <PrimaryButton
          label={hasText ? 'Continue' : 'Skip'}
          onPress={() => onNext()}
        />
      }
    >
      <TextInput
        style={styles.input}
        value={draft.description}
        onChangeText={description => onChange({ description })}
        placeholder="For example: The car started making a grinding sound yesterday. It gets louder when I brake."
        placeholderTextColor={colors.textLight}
        multiline
        textAlignVertical="top"
        maxLength={1000}
      />
      <Text style={styles.reassurance}>
        Don't worry if you're not sure what's wrong. Just describe what you
        noticed.
      </Text>
    </StepLayout>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 160,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    fontSize: 16,
    lineHeight: 22,
    color: colors.textDark,
  },
  reassurance: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textGrey,
  },
});
