import {
  Briefcase,
  House,
  LucideIcon,
  MapPin,
  Navigation,
} from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { colors } from '../../../shared/theme/colors';
import { OptionCard } from '../components/OptionCard';
import { StepLayout } from '../components/StepLayout';
import { RequestLocation } from '../types';
import { StepProps } from './stepProps';

// TODO: replace with GPS + saved places from the backend, and confirm the
// spot with a map pin.
const PRESETS: (RequestLocation & { Icon: LucideIcon; title: string })[] = [
  {
    kind: 'current',
    title: 'Use my current location',
    label: 'Current location',
    address: 'Near Yaya Centre, Kilimani',
    Icon: Navigation,
  },
  {
    kind: 'home',
    title: 'Home',
    label: 'Home',
    address: 'Kileleshwa, Nairobi',
    Icon: House,
  },
  {
    kind: 'work',
    title: 'Work',
    label: 'Work',
    address: 'Westlands, Nairobi',
    Icon: Briefcase,
  },
];

export function LocationStep({ draft, onNext }: StepProps) {
  const current = draft.location;
  const [choosingOther, setChoosingOther] = useState(current?.kind === 'other');
  const [otherText, setOtherText] = useState(
    current?.kind === 'other' ? current.address : '',
  );

  return (
    <StepLayout
      title="Where is the vehicle?"
      footer={
        choosingOther && (
          <PrimaryButton
            label="Continue"
            disabled={!otherText.trim()}
            onPress={() =>
              onNext({
                location: {
                  kind: 'other',
                  label: 'Other location',
                  address: otherText.trim(),
                },
              })
            }
          />
        )
      }
    >
      {PRESETS.map(({ Icon, title, ...location }) => (
        <OptionCard
          key={location.kind}
          leading={<Icon color={colors.primary} size={22} />}
          label={title}
          description={location.address}
          selected={!choosingOther && current?.kind === location.kind}
          onPress={() => onNext({ location })}
        />
      ))}
      <OptionCard
        leading={<MapPin color={colors.primary} size={22} />}
        label="Choose another location"
        selected={choosingOther}
        onPress={() => setChoosingOther(true)}
      />
      {choosingOther && (
        <TextInput
          style={styles.input}
          value={otherText}
          onChangeText={setOtherText}
          placeholder="Area, street or nearest landmark"
          placeholderTextColor={colors.textLight}
          autoFocus
        />
      )}
    </StepLayout>
  );
}

const styles = StyleSheet.create({
  input: {
    height: 50,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    fontSize: 16,
    color: colors.textDark,
  },
});
