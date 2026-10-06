import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { colors } from '../../../shared/theme/colors';
import { vehicleName } from '../../data/mockVehicles';
import { StepLayout } from '../components/StepLayout';
import { getCategory } from '../data/categories';
import { QUESTIONS } from '../data/questions';
import { questionStep, resolveQuestionPath, StepKey } from '../engine';
import { RequestDraft, Vehicle } from '../types';
import { DRIVABILITY_OPTIONS } from './DrivabilityStep';
import { formatDay } from './UrgencyStep';

type Props = {
  draft: RequestDraft;
  vehicle?: Vehicle;
  onEdit: (step: StepKey) => void;
  onSubmit: () => void;
};

function urgencyText(draft: RequestDraft) {
  switch (draft.urgency) {
    case 'now':
      return 'As soon as possible';
    case 'today':
      return 'Today';
    case 'scheduled':
      return draft.scheduledFor
        ? `${formatDay(draft.scheduledFor.date)} at ${draft.scheduledFor.time}`
        : 'Scheduled';
    default:
      return '';
  }
}

export function ReviewStep({ draft, vehicle, onEdit, onSubmit }: Props) {
  const category = getCategory(draft.categoryId);
  const questionIds = resolveQuestionPath(draft.categoryId, draft.answers);
  const drivability = DRIVABILITY_OPTIONS.find(o => o.id === draft.drivability);
  const description = draft.description.trim();

  return (
    <StepLayout
      title="Review your request"
      footer={
        <>
          <Text style={styles.note}>
            You won't be charged for repairs until you approve the quote.
          </Text>
          <PrimaryButton label="Request help" onPress={onSubmit} />
        </>
      }
    >
      <Section title="Vehicle" onEdit={() => onEdit('vehicle')}>
        <Text style={styles.primary}>{vehicle && vehicleName(vehicle)}</Text>
        <Text style={styles.secondary}>{vehicle?.registration}</Text>
      </Section>

      <Section title="Job" onEdit={() => onEdit('category')}>
        <Text style={styles.primary}>
          {draft.requestType === 'repair' ? 'Repair' : 'Service'} →{' '}
          {category?.label}
        </Text>
      </Section>

      {questionIds.length > 0 && (
        <Section
          title="What you told us"
          onEdit={() => onEdit(questionStep(questionIds[0]))}
        >
          {questionIds.map(id => {
            const question = QUESTIONS[id];
            const labels = question.options
              .filter(o => draft.answers[id]?.includes(o.id))
              .map(o => o.label);
            return (
              <View key={id} style={styles.answer}>
                <Text style={styles.secondary}>{question.title}</Text>
                <Text style={styles.primary}>{labels.join(', ')}</Text>
              </View>
            );
          })}
        </Section>
      )}

      <Section title="In your words" onEdit={() => onEdit('description')}>
        <Text style={description ? styles.quote : styles.secondary}>
          {description || 'Nothing added'}
        </Text>
      </Section>

      <Section title="Vehicle condition" onEdit={() => onEdit('drivability')}>
        <View style={styles.inline}>
          <View style={[styles.dot, { backgroundColor: drivability?.color }]} />
          <Text style={styles.primary}>{drivability?.label}</Text>
        </View>
      </Section>

      <Section title="Location" onEdit={() => onEdit('location')}>
        <Text style={styles.primary}>{draft.location?.label}</Text>
        <Text style={styles.secondary}>{draft.location?.address}</Text>
      </Section>

      <Section title="When" onEdit={() => onEdit('urgency')}>
        <Text style={styles.primary}>{urgencyText(draft)}</Text>
      </Section>

      <Section title="Photos & video" onEdit={() => onEdit('media')}>
        <Text style={styles.secondary}>
          {draft.media.length > 0
            ? `${draft.media.length} attached`
            : 'None added'}
        </Text>
      </Section>
    </StepLayout>
  );
}

type SectionProps = {
  title: string;
  onEdit: () => void;
  children: ReactNode;
};

function Section({ title, onEdit, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button">
          <Text style={styles.edit}>Edit</Text>
        </Pressable>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
    gap: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textGrey,
  },
  edit: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  primary: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textDark,
  },
  secondary: {
    fontSize: 14,
    color: colors.textGrey,
  },
  quote: {
    fontSize: 15,
    lineHeight: 21,
    fontStyle: 'italic',
    color: colors.textDark,
  },
  answer: {
    marginTop: 6,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  note: {
    fontSize: 13,
    textAlign: 'center',
    color: colors.textGrey,
  },
});
