import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Check } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { colors } from '../../shared/theme/colors';
import type { CustomerStackParamList } from '../navigation/CustomerNavigator';

type Props = NativeStackScreenProps<CustomerStackParamList, 'RequestSubmitted'>;

// TODO: becomes the start of the job lifecycle (matching → provider found…).
export function RequestSubmittedScreen({ navigation }: Props) {
  const { bottom } = useSafeAreaInsets();

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
      </View>
      <PrimaryButton
        label="Back to home"
        onPress={() => navigation.popToTop()}
      />
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
});
