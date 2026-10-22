import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../shared/theme/colors';
import { useVehicles } from '../data/vehicles';
import type { CustomerStackParamList } from '../navigation/CustomerNavigator';
import { AddVehicleForm } from '../request/steps/VehicleStep';

type Props = NativeStackScreenProps<CustomerStackParamList, 'AddVehicle'>;

/** "Add a vehicle" from the account screen: the same form booking uses. */
export function AddVehicleScreen({ navigation }: Props) {
  const { top } = useSafeAreaInsets();
  const { add } = useVehicles();

  return (
    <View style={[styles.screen, { paddingTop: top }]}>
      <AddVehicleForm
        canCancel
        onCancel={navigation.goBack}
        onSave={async vehicle => {
          await add(vehicle);
          navigation.goBack();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
