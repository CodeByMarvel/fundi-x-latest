import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Check } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useJob } from '../../data/useJob';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { colors } from '../../shared/theme/colors';
import { vehicleName } from '../data/mockVehicles';
import type { CustomerStackParamList } from '../navigation/CustomerNavigator';

type Props = NativeStackScreenProps<CustomerStackParamList, 'RequestSubmitted'>;

export function RequestSubmittedScreen({ navigation, route }: Props) {
  const { bottom } = useSafeAreaInsets();
  const job = useJob(route.params.jobId);

  return (
    <View style={[styles.screen, { paddingBottom: bottom + 16 }]}>
      <View style={styles.body}>
        <View style={styles.badge}>
          <Check color={colors.surface} size={40} strokeWidth={3} />
        </View>
        <Text style={styles.title}>Request sent</Text>
        <Text style={styles.text}>
          We're finding the best fundi for your job. We'll let you know as soon
          as someone accepts.
        </Text>
        {job && (
          <Text style={styles.reference}>
            {vehicleName(job.vehicle)} · {job.vehicle.registration}
            {'\n'}Reference {job.id}
          </Text>
        )}
      </View>
      <View style={styles.actions}>
        <PrimaryButton
          label="Track your request"
          onPress={() =>
            navigation.replace('JobTracking', { jobId: route.params.jobId })
          }
        />
        <PrimaryButton
          variant="ghost"
          label="Back to home"
          onPress={() => navigation.popToTop()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  badge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.success,
    marginBottom: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textDark,
  },
  text: {
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
    color: colors.textGrey,
    maxWidth: 300,
  },
  actions: {
    gap: 8,
  },
  reference: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    color: colors.textLight,
  },
});
