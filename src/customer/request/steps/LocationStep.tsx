import {
  Briefcase,
  House,
  LucideIcon,
  MapPin,
  Navigation,
} from 'lucide-react-native';
import { useState } from 'react';
import { Alert, StyleSheet, TextInput } from 'react-native';
import { useAuth } from '../../../auth/AuthContext';
import { Coordinates } from '../../../domain/jobs/request';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { useAsyncAction } from '../../../shared/hooks/useAsyncAction';
import { currentPosition } from '../../../shared/location/currentPosition';
import { colors } from '../../../shared/theme/colors';
import { PlaceKind, useSavedPlaces } from '../../data/places';
import { OptionCard } from '../components/OptionCard';
import { StepLayout } from '../components/StepLayout';
import { StepProps } from './stepProps';

/** Demo mode has no GPS: "current location" is a fixed spot in Kilimani. */
const DEMO_HERE: Coordinates = { lat: -1.2925, lng: 36.7875 };

const PLACES: { kind: PlaceKind; title: string; Icon: LucideIcon }[] = [
  { kind: 'home', title: 'Home', Icon: House },
  { kind: 'work', title: 'Work', Icon: Briefcase },
];

/** Which choice is open for typing: a landmark, or a place being saved. */
type Open = 'current' | PlaceKind | 'other' | null;

/**
 * Where the vehicle is. Matching needs a real position, so every choice
 * ends with coordinates: the phone's GPS, or a saved place (saved from
 * the GPS the first time it's used). A spot elsewhere needs a map pin,
 * which isn't built yet, so "another location" only works in demo mode.
 */
export function LocationStep({ draft, onNext }: StepProps) {
  const current = draft.location;
  const signedIn = useAuth().state.status === 'signedIn';
  const saved = useSavedPlaces();
  const [open, setOpen] = useState<Open>(
    current?.kind === 'other' ? 'other' : null,
  );
  const [text, setText] = useState(
    current?.kind === 'other' ? current.address : '',
  );
  const { pending, run } = useAsyncAction<'locate'>();

  const here = () =>
    signedIn ? currentPosition('find mechanics near your car') : Promise.resolve(DEMO_HERE);

  const choose = (next: Open) => {
    setOpen(next);
    setText('');
  };

  const useHere = () =>
    run('locate', async () => {
      const coords = await here();
      const landmark = text.trim();
      onNext({
        location: {
          kind: 'current',
          label: 'Current location',
          address: landmark || 'Current location (GPS)',
          coords,
        },
      });
    });

  const saveHere = (kind: PlaceKind, title: string) =>
    run('locate', async () => {
      const place = await saved.save(kind, text.trim(), await here());
      onNext({
        location: { kind, label: title, address: place.address, coords: place.coords },
      });
    });

  const savingKind = open === 'home' || open === 'work' ? open : null;
  const savingTitle = PLACES.find(p => p.kind === savingKind)?.title ?? '';

  const footer =
    open === 'current' ? (
      <PrimaryButton label="Use my location" loading={pending === 'locate'} onPress={useHere} />
    ) : savingKind ? (
      <PrimaryButton
        label={`Save my location as ${savingTitle}`}
        disabled={!text.trim()}
        loading={pending === 'locate'}
        onPress={() => saveHere(savingKind, savingTitle)}
      />
    ) : open === 'other' ? (
      <PrimaryButton
        label="Continue"
        disabled={!text.trim()}
        onPress={() =>
          onNext({
            location: { kind: 'other', label: 'Other location', address: text.trim() },
          })
        }
      />
    ) : null;

  return (
    <StepLayout title="Where is the vehicle?" footer={footer}>
      <OptionCard
        leading={<Navigation color={colors.primary} size={22} />}
        label="Use my current location"
        description="Your phone's GPS. You can add a landmark."
        selected={open === 'current' || (!open && current?.kind === 'current')}
        onPress={() => choose('current')}
      />
      {open === 'current' && (
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Nearest landmark (optional)"
          placeholderTextColor={colors.textLight}
          autoFocus
        />
      )}

      {PLACES.map(({ kind, title, Icon }) => {
        const place = saved[kind];
        return [
          <OptionCard
            key={kind}
            leading={<Icon color={colors.primary} size={22} />}
            label={title}
            description={
              place?.address ??
              (saved.places ? 'Not saved yet: tap when you are there' : 'Loading…')
            }
            selected={open === kind || (!open && current?.kind === kind)}
            onPress={() =>
              place
                ? onNext({
                    location: { kind, label: title, address: place.address, coords: place.coords },
                  })
                : saved.places && choose(kind)
            }
          />,
          open === kind && (
            <TextInput
              key={`${kind}-address`}
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder={`Describe where ${title} is, e.g. Kileleshwa, off Othaya Rd`}
              placeholderTextColor={colors.textLight}
              autoFocus
            />
          ),
        ];
      })}

      <OptionCard
        leading={<MapPin color={colors.primary} size={22} />}
        label="Choose another location"
        description={signedIn ? 'Coming soon: pick the spot on a map' : undefined}
        selected={open === 'other'}
        onPress={() =>
          signedIn
            ? Alert.alert(
                'Coming soon',
                'Picking a spot on a map is on its way. For now, use your current location or a saved place.',
              )
            : choose('other')
        }
      />
      {open === 'other' && (
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
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
