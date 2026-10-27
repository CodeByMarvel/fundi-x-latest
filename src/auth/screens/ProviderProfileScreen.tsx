import { ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Coordinates } from '../../domain/jobs/request';
import {
  SKILLS,
  Transport,
  TRANSPORTS,
  TRAVEL_LIMITS_KM,
} from '../../domain/providers/skills';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { TextField } from '../../shared/components/TextField';
import {
  currentPosition,
  LocationError,
} from '../../shared/location/currentPosition';
import { colors } from '../../shared/theme/colors';
import { ServerError } from '../api';
import { useAuth } from '../AuthContext';
import { AuthLayout, ErrorText } from './AuthLayout';

// Garages are parked while Fundi-X starts with mobile mechanics (see
// docs/garage-providers.md). Adding the entry back brings the picker back.
const TYPES: readonly { type: 'mechanic' | 'garage'; label: string }[] = [
  { type: 'mechanic', label: 'Mobile mechanic' },
];

const SKILL_GROUPS = [
  { group: 'repair', title: 'Repairs' },
  { group: 'service', title: 'Servicing' },
] as const;

/**
 * A mechanic's profile (docs/mechanic-onboarding.md, "Profile"): what they
 * can do and where they work. Matching only offers jobs in their skills,
 * within their travel limit from base. Fundi-X verifies it before any job
 * is offered. Mechanics from before this version see it filled in with
 * what they had and complete the rest.
 */
export function ProviderProfileScreen() {
  const { state, setProviderProfile, signOut } = useAuth();
  const saved =
    state.status === 'signedIn' ? state.account.provider : null;

  const [type, setType] = useState<'mechanic' | 'garage'>(
    saved?.type ?? 'mechanic',
  );
  const [businessName, setBusinessName] = useState(saved?.businessName ?? '');
  const [skills, setSkills] = useState<string[]>(saved?.skills ?? []);
  const [experience, setExperience] = useState(
    saved?.experienceYears != null ? String(saved.experienceYears) : '',
  );
  const [transport, setTransport] = useState<Transport | null>(
    saved?.transport ?? null,
  );
  const [base, setBase] = useState<Coordinates | null>(saved?.base ?? null);
  const [baseDescription, setBaseDescription] = useState(
    saved?.baseDescription ?? '',
  );
  const [travelKm, setTravelKm] = useState<number | null>(
    saved?.travelKm ?? null,
  );
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const years = /^\d{1,2}$/.test(experience.trim())
    ? Number(experience.trim())
    : null;
  const ready =
    skills.length > 0 &&
    years !== null &&
    transport !== null &&
    base !== null &&
    baseDescription.trim().length >= 2 &&
    travelKm !== null &&
    (type === 'mechanic' || businessName.trim().length >= 2);

  function toggleSkill(id: string) {
    setSkills(now =>
      now.includes(id) ? now.filter(s => s !== id) : [...now, id],
    );
  }

  async function useHere() {
    setLocating(true);
    setError(null);
    try {
      setBase(await currentPosition('set where you work from'));
    } catch (err) {
      setError(
        err instanceof LocationError
          ? err.message
          : 'Could not find your location. Please try again.',
      );
    } finally {
      setLocating(false);
    }
  }

  async function save() {
    if (!ready) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setProviderProfile({
        type,
        ...(type === 'garage' && { businessName: businessName.trim() }),
        skills,
        experienceYears: years,
        transport,
        base,
        baseDescription: baseDescription.trim(),
        travelKm,
      });
    } catch (err) {
      setError(
        err instanceof ServerError
          ? err.message
          : 'Could not save. Please try again.',
      );
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Tell us about your work"
      subtitle={
        saved
          ? 'Fundi-X now matches jobs to your skills and area. Please complete your profile to keep receiving jobs.'
          : "Fundi-X checks every mechanic before sending jobs. We'll contact you to verify your details."
      }
      footer={
        <PrimaryButton
          label="Use a different account"
          variant="ghost"
          onPress={signOut}
        />
      }
    >
      {TYPES.length > 1 && (
        <Choices
          options={TYPES.map(t => ({ id: t.type, label: t.label }))}
          selected={[type]}
          onPress={id => setType(id as 'mechanic' | 'garage')}
          role="radio"
        />
      )}
      {type === 'garage' && (
        <TextField
          label="Garage name"
          placeholder="Kilimani Auto Garage"
          value={businessName}
          onChangeText={setBusinessName}
          maxLength={100}
        />
      )}

      <Section
        title="What can you do?"
        hint="You'll only be offered jobs you pick here."
      >
        {SKILL_GROUPS.map(g => (
          <View key={g.group} style={styles.group}>
            <Text style={styles.groupTitle}>{g.title}</Text>
            <Choices
              options={SKILLS.filter(s => s.group === g.group)}
              selected={skills}
              onPress={toggleSkill}
              role="checkbox"
            />
          </View>
        ))}
      </Section>

      <TextField
        label="Years of experience"
        placeholder="5"
        value={experience}
        onChangeText={setExperience}
        keyboardType="number-pad"
        maxLength={2}
      />

      <Section title="How do you get to jobs?">
        <Choices
          options={TRANSPORTS}
          selected={transport ? [transport] : []}
          onPress={id => setTransport(id as Transport)}
          role="radio"
        />
      </Section>

      <Section
        title="Where do you work from?"
        hint="Stand at your usual base (home, stage or workshop) and tap the button."
      >
        <PrimaryButton
          label={base ? 'Base set · use where I am now' : 'Use where I am now'}
          variant={base ? 'outline' : 'primary'}
          onPress={useHere}
          loading={locating}
        />
        <TextField
          label="Describe it"
          placeholder="Kilimani, near Yaya Centre"
          value={baseDescription}
          onChangeText={setBaseDescription}
          maxLength={100}
        />
      </Section>

      <Section
        title="How far will you travel?"
        hint="Measured from your base. Jobs further away won't be offered."
      >
        <Choices
          options={TRAVEL_LIMITS_KM.map(km => ({
            id: String(km),
            label: `${km} km`,
          }))}
          selected={travelKm ? [String(travelKm)] : []}
          onPress={id => setTravelKm(Number(id))}
          role="radio"
        />
      </Section>

      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label={saved ? 'Save profile' : 'Submit for verification'}
        onPress={save}
        loading={busy}
        disabled={!ready}
      />
    </AuthLayout>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint && <Text style={styles.hint}>{hint}</Text>}
      {children}
    </View>
  );
}

/** Tappable chips: one choice (radio) or several (checkbox). */
function Choices({
  options,
  selected,
  onPress,
  role,
}: {
  options: readonly { id: string; label: string }[];
  selected: readonly string[];
  onPress: (id: string) => void;
  role: 'radio' | 'checkbox';
}) {
  return (
    <View style={styles.chips}>
      {options.map(o => {
        const on = selected.includes(o.id);
        return (
          <Pressable
            key={o.id}
            onPress={() => onPress(o.id)}
            style={[styles.chip, on && styles.chipOn]}
            accessibilityRole={role}
            accessibilityState={role === 'radio' ? { selected: on } : { checked: on }}
          >
            <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textDark,
  },
  hint: {
    fontSize: 13,
    color: colors.textGrey,
  },
  group: {
    gap: 6,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textGrey,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  chipOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySurface,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textGrey,
  },
  chipLabelOn: {
    color: colors.primary,
  },
});
