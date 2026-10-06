import { StyleSheet, View } from 'react-native';
import { colors } from '../../../shared/theme/colors';
import { OptionCard } from '../components/OptionCard';
import { StepLayout } from '../components/StepLayout';
import { Drivability } from '../types';
import { StepProps } from './stepProps';

export const DRIVABILITY_OPTIONS: {
  id: Drivability;
  label: string;
  color: string;
}[] = [
  { id: 'safe', label: "Yes, it's safe to drive", color: colors.success },
  {
    id: 'caution',
    label: "It can move, but I'd rather not drive it",
    color: colors.warning,
  },
  { id: 'cannot', label: "No, it can't be driven", color: colors.error },
  { id: 'unsure', label: "I'm not sure", color: colors.inactive },
];

export function DrivabilityStep({ draft, onNext }: StepProps) {
  return (
    <StepLayout
      title="Can the vehicle be driven?"
      subtitle="This helps us send the right kind of help."
    >
      {DRIVABILITY_OPTIONS.map(o => (
        <OptionCard
          key={o.id}
          leading={<View style={[styles.dot, { backgroundColor: o.color }]} />}
          label={o.label}
          selected={draft.drivability === o.id}
          onPress={() => onNext({ drivability: o.id })}
        />
      ))}
    </StepLayout>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
});
