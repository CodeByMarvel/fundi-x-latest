import { Car, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { colors } from '../../../shared/theme/colors';
import { vehicleName } from '../../data/mockVehicles';
import { OptionCard } from '../components/OptionCard';
import { StepLayout } from '../components/StepLayout';
import { Vehicle } from '../types';
import { StepProps } from './stepProps';

type Props = StepProps & {
  vehicles: Vehicle[];
  onAddVehicle: (vehicle: Vehicle) => void;
};

export function VehicleStep({ draft, onNext, vehicles, onAddVehicle }: Props) {
  const [adding, setAdding] = useState(vehicles.length === 0);

  if (adding) {
    return (
      <AddVehicleForm
        canCancel={vehicles.length > 0}
        onCancel={() => setAdding(false)}
        onSave={vehicle => {
          onAddVehicle(vehicle);
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
  onCancel: () => void;
  onSave: (vehicle: Vehicle) => void;
};

function AddVehicleForm({ canCancel, onCancel, onSave }: FormProps) {
  const [registration, setRegistration] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');

  const valid = registration.trim() && make.trim() && model.trim();

  const save = () => {
    const parsedYear = parseInt(year, 10);
    onSave({
      // TODO: replace with the id the backend returns.
      id: `local-${Date.now()}`,
      registration: registration.trim().toUpperCase(),
      make: make.trim(),
      model: model.trim(),
      year: Number.isNaN(parsedYear) ? undefined : parsedYear,
    });
  };

  return (
    <StepLayout
      title="Add a vehicle"
      subtitle="Just the basics for now. You can add more details later."
      footer={
        <>
          <PrimaryButton
            label="Save vehicle"
            onPress={save}
            disabled={!valid}
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
    </StepLayout>
  );
}

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
});
