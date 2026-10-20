import { useEffect, useState } from 'react';
import { pricingService } from '../../../data/backend';
import { categoriesFor, setOfferedServices } from '../data/categories';
import { OptionCard } from '../components/OptionCard';
import { StepLayout } from '../components/StepLayout';
import { StepProps } from './stepProps';

export function CategoryStep({ draft, onNext }: StepProps) {
  const isRepair = draft.requestType === 'repair';
  const [categories, setCategories] = useState(() =>
    categoriesFor(draft.requestType),
  );

  // Fundi-X may offer services added since this app version was built.
  useEffect(() => {
    if (isRepair) {
      return;
    }
    let active = true;
    pricingService
      .services()
      .then(services => {
        setOfferedServices(services);
        if (active) {
          setCategories(categoriesFor(draft.requestType));
        }
      })
      .catch(() => {}); // the built-in list still works
    return () => {
      active = false;
    };
  }, [isRepair, draft.requestType]);

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
