import { Bell, MapPin } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

type Props = {
  firstName: string;
  location: string;
  onNotificationsPress?: () => void;
};

export function HomeHeader({
  firstName,
  location,
  onNotificationsPress,
}: Props) {
  return (
    <View style={styles.row}>
      <View>
        <Text style={styles.greeting}>👋 Hi, {firstName}</Text>
        <View style={styles.locationRow}>
          <MapPin color={colors.textGrey} size={14} />
          <Text style={styles.location}>{location}</Text>
        </View>
      </View>
      <Pressable
        style={styles.bell}
        onPress={onNotificationsPress}
        accessibilityLabel="Notifications"
      >
        <Bell color={colors.textDark} size={22} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textDark,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  location: {
    fontSize: 14,
    color: colors.textGrey,
  },
  bell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
});
