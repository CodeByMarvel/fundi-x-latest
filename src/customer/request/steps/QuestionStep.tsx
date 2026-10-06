import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { OptionCard } from '../components/OptionCard';
import { StepLayout } from '../components/StepLayout';
import { Question } from '../types';
import { StepProps } from './stepProps';

type Props = StepProps & { question: Question };

/** Renders any guided question from the decision tree. */
export function QuestionStep({ draft, onChange, onNext, question }: Props) {
  const selected = draft.answers[question.id] ?? [];

  const setAnswer = (optionIds: string[]) => ({
    answers: { ...draft.answers, [question.id]: optionIds },
  });

  const toggle = (optionId: string) => {
    const next = selected.includes(optionId)
      ? selected.filter(id => id !== optionId)
      : [...selected, optionId];
    onChange(setAnswer(next));
  };

  return (
    <StepLayout
      title={question.title}
      subtitle={question.subtitle}
      footer={
        question.multi && (
          <PrimaryButton
            label="Continue"
            onPress={() => onNext()}
            disabled={selected.length === 0}
          />
        )
      }
    >
      {question.options.map(option => (
        <OptionCard
          key={option.id}
          label={option.label}
          description={option.description}
          multi={question.multi}
          selected={selected.includes(option.id)}
          onPress={() =>
            question.multi ? toggle(option.id) : onNext(setAnswer([option.id]))
          }
        />
      ))}
    </StepLayout>
  );
}
