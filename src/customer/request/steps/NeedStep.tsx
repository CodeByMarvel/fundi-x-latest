import { TriangleAlert, Wrench } from 'lucide-react-native';
import { colors } from '../../../shared/theme/colors';
import { OptionCard } from '../components/OptionCard';
import { StepLayout } from '../components/StepLayout';
import { StepProps } from './stepProps';

export function NeedStep({ draft, onNext }: StepProps) {
  return (
    <StepLayout
      title="What does your vehicle need?"
      subtitle="Tell us what you need help with."
    >
      <OptionCard
        leading={<TriangleAlert color={colors.primary} size={22} />}
        label="I have a problem"
        description="Something is wrong with my vehicle."
        selected={draft.requestType === 'repair'}
        onPress={() => onNext({ requestType: 'repair' })}
      />
      <OptionCard
        leading={<Wrench color={colors.primary} size={22} />}
        label="I need a service"
        description="Maintenance or a service you already know you need."
        selected={draft.requestType === 'service'}
        onPress={() => onNext({ requestType: 'service' })}
      />
    </StepLayout>
  );
}
