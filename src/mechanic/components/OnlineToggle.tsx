import { StyleSheet, Switch, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { providerRepository } from '../../data/backend';
import { useProvider } from '../../data/useJob';
import { useAsyncAction } from '../../shared/hooks/useAsyncAction';
import { currentPosition } from '../../shared/location/currentPosition';
import { colors } from '../../shared/theme/colors';

/**
 * Online providers get offered jobs; offline ones don't. Going online
 * sends the current position, so matching can find them at once. (In demo
 * mode, turning Brian offline lets the simulated fundis take requests.)
 */
export function OnlineToggle({ providerId }: { providerId: string }) {
  const provider = useProvider(providerId);
  const signedIn = useAuth().state.status === 'signedIn';
  const { pending, run } = useAsyncAction<'toggle'>();
  const online = provider?.online ?? false;

  return (
    <View style={[styles.card, online && styles.cardOnline]}>
      <View style={[styles.dot, online && styles.dotOnline]} />
      <View style={styles.body}>
        <Text style={styles.title}>
          {online ? "You're online" : "You're offline"}
        </Text>
        <Text style={styles.text}>
          {online
            ? 'New jobs near you will be offered to you.'
            : "You won't get new job requests."}
        </Text>
      </View>
      <Switch
        value={online}
        disabled={pending !== null}
        onValueChange={value => {
          run('toggle', async () => {
            const location =
              value && signedIn ? await currentPosition() : undefined;
            await providerRepository.setOnline(providerId, value, location);
          });
        }}
        trackColor={{ true: colors.success, false: colors.inactive }}
        thumbColor={colors.surface}
        accessibilityLabel="Online"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  cardOnline: {
    borderColor: colors.success,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.inactive,
  },
  dotOnline: {
    backgroundColor: colors.success,
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textDark,
  },
  text: {
    fontSize: 13,
    color: colors.textGrey,
    marginTop: 2,
  },
});
