import { useState } from 'react';
import { Text } from 'react-native';
import {
  sameCar,
  vehicleDetails,
  vehicleName,
} from '../../../domain/jobs/request';
import { Job } from '../../../domain/jobs/types';
import { Card, textStyles } from '../../../shared/components/Card';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { useAsyncAction } from '../../../shared/hooks/useAsyncAction';
import { useVehicles } from '../../data/vehicles';

/**
 * After a job on a car that isn't in "My vehicles" (e.g. one they had
 * inspected before buying): offers to keep it for next time.
 */
export function SaveVehiclePanel({ job }: { job: Job }) {
  const { vehicles, add } = useVehicles();
  const [saved, setSaved] = useState(false);
  const { pending, run } = useAsyncAction<'save'>();
  const car = job.vehicle;

  if (saved) {
    return (
      <Card title="My vehicles">
        <Text style={textStyles.secondary}>
          {car.registration} is saved. Pick it next time you book.
        </Text>
      </Card>
    );
  }
  if (!vehicles || vehicles.some(v => sameCar(v, car))) {
    return null;
  }

  return (
    <Card title="Keep this car?">
      <Text style={textStyles.secondary}>
        Save your {vehicleName(car)} ({car.registration}) to My vehicles, so you
        don’t have to type it in next time.
      </Text>
      <PrimaryButton
        label="Save to My vehicles"
        variant="outline"
        loading={pending === 'save'}
        onPress={() =>
          run('save', async () => {
            await add(vehicleDetails(car));
            setSaved(true);
          })
        }
      />
    </Card>
  );
}
