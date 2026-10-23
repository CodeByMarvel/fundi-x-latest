import { Car, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ServerError } from '../../../auth/api';
import type { Fuel } from '../../../domain/jobs/request';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { colors } from '../../../shared/theme/colors';
import { vehicleName } from '../../../domain/jobs/request';
import { OptionCard } from '../components/OptionCard';
import { StepLayout } from '../components/StepLayout';
import { VehicleInput } from '../../data/vehicles';
import { Vehicle } from '../types';
import { StepProps } from './stepProps';

type Props = StepProps & {
  /** `null` while "My vehicles" is still loading. */
  vehicles: Vehicle[] | null;
  /** Adds it to this booking and returns it with an id. */
  onAddVehicle: (vehicle: VehicleInput) => Promise<Vehicle>;
};

export function VehicleStep({ draft, onNext, vehicles, onAddVehicle }: Props) {
  const [adding, setAdding] = useState(false);

  if (!vehicles) {
    return (
      <StepLayout title="Which vehicle needs help?">
        <ActivityIndicator color={colors.primary} />
      </StepLayout>
    );
  }

  if (adding || vehicles.length === 0) {
    return (
      <AddVehicleForm
        canCancel={vehicles.length > 0}
        saveLabel="Continue"
        onCancel={() => setAdding(false)}
        onSave={async input => {
          const vehicle = await onAddVehicle(input);
          onNext({ vehicleId: vehicle.id });
        }}
      />
    );
  }

  return (
    <StepLayout title="Which vehicle needs help?">
      {vehicles.map(v => (
        <OptionCard
          key={v.id}
          leading={<Car color={colors.primary} size={22} />}
          label={vehicleName(v)}
          description={v.registration}
          selected={draft.vehicleId === v.id}
          onPress={() => onNext({ vehicleId: v.id })}
        />
      ))}
      <OptionCard
        leading={<Plus color={colors.primary} size={22} />}
        label="Add another vehicle"
        onPress={() => setAdding(true)}
      />
    </StepLayout>
  );
}

type FormProps = {
  canCancel: boolean;
  saveLabel?: string;
  onCancel: () => void;
  onSave: (vehicle: VehicleInput) => Promise<void>;
};

/** Booking's "add a vehicle" step, and the account screen's. */
export function AddVehicleForm({
  canCancel,
  saveLabel = 'Save vehicle',
  onCancel,
  onSave,
}: FormProps) {
  const [registration, setRegistration] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [engineCc, setEngineCc] = useState('');
  const [fuel, setFuel] = useState<Fuel>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = registration.trim() && make.trim() && model.trim();

  const save = async () => {
    const parsedYear = parseInt(year, 10);
    const parsedCc = parseInt(engineCc, 10);
    setSaving(true);
    setError(null);
    try {
      await onSave({
        registration: registration.trim().toUpperCase(),
        make: make.trim(),
        model: model.trim(),
        ...(parsedYear >= 1950 && parsedYear <= 2100 && { year: parsedYear }),
        ...(parsedCc >= 50 && parsedCc <= 10000 && { engineCc: parsedCc }),
        ...(fuel && { fuel }),
      });
    } catch (err) {
      // e.g. "KDA 123A is already in your vehicles", or no connection.
      setError(err instanceof ServerError ? err.message : 'Could not save. Please try again.');
      setSaving(false);
    }
  };

  return (
    <StepLayout
      title="Add a vehicle"
      subtitle="Just the basics for now. You can add more details later."
      footer={
        <>
          {error && <Text style={styles.error}>{error}</Text>}
          <PrimaryButton
            label={saveLabel}
            onPress={save}
            disabled={!valid}
            loading={saving}
          />
          {canCancel && (
            <PrimaryButton label="Cancel" variant="ghost" onPress={onCancel} />
          )}
        </>
      }
    >
      <Field
        label="Registration number"
        value={registration}
        onChangeText={setRegistration}
        placeholder="e.g. KDA 123A"
        autoCapitalize="characters"
      />
      <Field
        label="Make"
        value={make}
        onChangeText={setMake}
        placeholder="e.g. Toyota"
      />
      <Field
        label="Model"
        value={model}
        onChangeText={setModel}
        placeholder="e.g. Fielder"
      />
      <Field
        label="Year (optional)"
        value={year}
        onChangeText={setYear}
        placeholder="e.g. 2015"
        keyboardType="number-pad"
        maxLength={4}
      />
      <Field
        label="Engine size in cc (optional)"
        value={engineCc}
        onChangeText={text => setEngineCc(text.replace(/[^\d]/g, ''))}
        placeholder="e.g. 1500"
        keyboardType="number-pad"
        maxLength={5}
      />
      <View>
        <Text style={styles.label}>Fuel (optional)</Text>
        <View style={styles.chips}>
          {FUELS.map(f => (
            <Pressable
              key={f.id}
              onPress={() => setFuel(fuel === f.id ? undefined : f.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: fuel === f.id }}
              style={[styles.chip, fuel === f.id && styles.chipSelected]}
            >
              <Text style={[styles.chipText, fuel === f.id && styles.chipTextSelected]}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>
          Service prices depend on the engine. Not sure? Leave it: we use your
          model's usual engine.
        </Text>
      </View>
    </StepLayout>
  );
}

const FUELS: { id: Fuel; label: string }[] = [
  { id: 'petrol', label: 'Petrol' },
  { id: 'diesel', label: 'Diesel' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'electric', label: 'Electric' },
];

type FieldProps = React.ComponentProps<typeof TextInput> & { label: string };

function Field({ label, ...inputProps }: FieldProps) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.textLight}
        {...inputProps}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textDark,
    marginBottom: 6,
  },
  input: {
    height: 50,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    fontSize: 16,
    color: colors.textDark,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySurface,
  },
  chipText: {
    fontSize: 15,
    color: colors.textDark,
  },
  chipTextSelected: {
    fontWeight: '600',
    color: colors.primary,
  },
  error: {
    fontSize: 14,
    color: colors.error,
    textAlign: 'center',
    marginBottom: 8,
  },
  hint: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textGrey,
  },
});
