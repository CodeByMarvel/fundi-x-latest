import { Text } from 'react-native';
import { Job } from '../../../domain/jobs/types';
import { Card, Detail, textStyles } from '../../../shared/components/Card';
import { vehicleName } from '../../data/mockVehicles';
import { getCategory } from '../../request/data/categories';

/** What the customer asked for, shown at every stage. */
export function JobDetailsCard({ job }: { job: Job }) {
  return (
    <Card title="Your request">
      <Detail label="Vehicle">
        <Text style={textStyles.primary}>{vehicleName(job.vehicle)}</Text>
        <Text style={textStyles.secondary}>{job.vehicle.registration}</Text>
      </Detail>
      <Detail label="Problem">
        <Text style={textStyles.primary}>
          {getCategory(job.categoryId)?.label}
        </Text>
        {!!job.description && (
          <Text style={textStyles.secondary}>{job.description}</Text>
        )}
      </Detail>
      <Detail label="Location">
        <Text style={textStyles.primary}>{job.location.label}</Text>
        <Text style={textStyles.secondary}>{job.location.address}</Text>
      </Detail>
      <Detail label="Reference">
        <Text style={textStyles.secondary}>{job.id}</Text>
      </Detail>
    </Card>
  );
}
