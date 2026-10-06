import { Camera, Video } from 'lucide-react-native';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { colors } from '../../../shared/theme/colors';
import { OptionCard } from '../components/OptionCard';
import { StepLayout } from '../components/StepLayout';
import { getCategory } from '../data/categories';
import { MediaHint } from '../types';
import { StepProps } from './stepProps';

const HINTS: Record<MediaHint, string | undefined> = {
  essential: 'A photo is really important for this type of request.',
  helpful: 'A photo or short video would help with this type of request.',
  optional: undefined,
};

// TODO: wire up a real camera/gallery picker (needs a native library).
function pickNotReady() {
  Alert.alert('Coming soon', 'Adding photos and videos is coming soon.');
}

export function MediaStep({ draft, onNext }: StepProps) {
  const hint = HINTS[getCategory(draft.categoryId)?.mediaHint ?? 'optional'];
  const count = draft.media.length;

  return (
    <StepLayout
      title="Can you show us the problem?"
      subtitle="Photos or a short video can help the mechanic understand the job before arriving."
      footer={
        <PrimaryButton
          label={count > 0 ? 'Continue' : 'Skip'}
          onPress={() => onNext()}
        />
      }
    >
      {hint && (
        <View style={styles.hint}>
          <Text style={styles.hintText}>{hint}</Text>
        </View>
      )}
      <OptionCard
        leading={<Camera color={colors.primary} size={22} />}
        label="Add photos"
        onPress={pickNotReady}
      />
      <OptionCard
        leading={<Video color={colors.primary} size={22} />}
        label="Add video"
        onPress={pickNotReady}
      />
      {count > 0 && <Text style={styles.count}>{count} attached</Text>}
    </StepLayout>
  );
}

const styles = StyleSheet.create({
  hint: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.primarySurface,
  },
  hintText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  count: {
    fontSize: 14,
    color: colors.textGrey,
  },
});
