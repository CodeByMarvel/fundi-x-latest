import { CATEGORIES } from '../data/categories';
import { OptionCard } from '../components/OptionCard';
import { StepLayout } from '../components/StepLayout';
import { StepProps } from './stepProps';

export function CategoryStep({ draft, onNext }: StepProps) {
  const isRepair = draft.requestType === 'repair';
  const categories = CATEGORIES.filter(
    c => c.requestType === draft.requestType,
  );

  return (
    <StepLayout
      title={isRepair ? "What's the problem?" : 'What service do you need?'}
      subtitle={
        isRepair
          ? "Pick the closest match. You don't need to know exactly what's wrong."
          : undefined
      }
    >
      {categories.map(c => (
        <OptionCard
          key={c.id}
          label={c.label}
          description={c.description}
          selected={draft.categoryId === c.id}
          onPress={() => onNext({ categoryId: c.id })}
        />
      ))}
    </StepLayout>
  );
}
