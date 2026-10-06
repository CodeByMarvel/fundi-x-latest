import { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import { LucideIcon } from 'lucide-react-native';
import { useMemo } from 'react';
import { Platform, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';

const ICON_SIZE = 24;

const FLOATING_BAR_HEIGHT = 64;
const FLOATING_BAR_GAP = 12;

function renderTabIcon(Icon: LucideIcon) {
  return ({ color }: { color: string }) => (
    <Icon color={color} size={ICON_SIZE} />
  );
}

const flatBarStyle: ViewStyle = {
  backgroundColor: colors.surface,
  borderTopColor: colors.divider,
};

function floatingBarStyle(bottomInset: number): ViewStyle {
  return {
    position: 'absolute',
    bottom: bottomInset + FLOATING_BAR_GAP,
    marginHorizontal: 16,
    height: FLOATING_BAR_HEIGHT,
    paddingTop: 8,
    paddingBottom: 8,
    borderRadius: 24,
    borderTopWidth: 0,
    backgroundColor: colors.surface,
    ...Platform.select({
      ios: {
        shadowColor: colors.textDark,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
      },
      android: { elevation: 10 },
    }),
  };
}

/**
 * Shared bottom-tab styling for both the customer and mechanic sides.
 * Pass a map of tab name -> icon. `floating` lifts the bar off the bottom edge
 * as a rounded card.
 */
export function useTabScreenOptions(
  icons: Record<string, LucideIcon>,
  { floating = false } = {},
) {
  const { bottom } = useSafeAreaInsets();

  return useMemo(() => {
    const tabBarStyle = floating ? floatingBarStyle(bottom) : flatBarStyle;

    return ({
      route,
    }: {
      route: { name: string };
    }): BottomTabNavigationOptions => ({
      headerShown: false,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.inactive,
      tabBarStyle,
      tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      tabBarIcon: renderTabIcon(icons[route.name]),
    });
  }, [icons, floating, bottom]);
}

/**
 * Bottom padding a scrollable screen needs so its last item isn't hidden
 * behind the floating tab bar.
 */
export function useFloatingTabBarSpace() {
  const { bottom } = useSafeAreaInsets();
  return bottom + FLOATING_BAR_GAP + FLOATING_BAR_HEIGHT + 16;
}
