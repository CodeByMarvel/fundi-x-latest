import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronRight } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectionTitle } from '../../shared/components/SectionTitle';
import { useFloatingTabBarSpace } from '../../shared/navigation/tabScreenOptions';
import { colors } from '../../shared/theme/colors';
import type { CustomerStackParamList } from '../navigation/CustomerNavigator';
import { CATEGORIES } from '../request/data/categories';
import { JobCategory, RequestType } from '../request/types';

const SECTIONS: { requestType: RequestType; title: string }[] = [
  { requestType: 'repair', title: 'Repairs' },
  { requestType: 'service', title: 'Servicing' },
];

/** Everything Fundi-X can help with. Picking one starts a request for it. */
export function ServicesScreen() {
  const { top } = useSafeAreaInsets();
  const tabBarSpace = useFloatingTabBarSpace();
  const navigation =
    useNavigation<NativeStackNavigationProp<CustomerStackParamList>>();

  const start = (category: JobCategory) =>
    navigation.navigate('RequestFlow', {
      requestType: category.requestType,
      categoryId: category.id,
    });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: top + 16, paddingBottom: tabBarSpace },
      ]}
    >
      <Text style={styles.heading}>Services</Text>
      <Text style={styles.subheading}>
        Pick what you need and we'll find a trusted fundi near you.
      </Text>

      {SECTIONS.map(section => (
        <View key={section.requestType} style={styles.section}>
          <SectionTitle>{section.title}</SectionTitle>
          <View style={styles.list}>
            {CATEGORIES.filter(c => c.requestType === section.requestType).map(
              category => (
                <Pressable
                  key={category.id}
                  style={styles.row}
                  onPress={() => start(category)}
                  accessibilityRole="button"
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.label}>{category.label}</Text>
                    {category.description && (
                      <Text style={styles.description} numberOfLines={1}>
                        {category.description}
                      </Text>
                    )}
                  </View>
                  <ChevronRight color={colors.textLight} size={18} />
                </Pressable>
              ),
            )}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 20,
  },
  heading: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textDark,
  },
  subheading: {
    fontSize: 15,
    color: colors.textGrey,
    marginTop: 4,
  },
  section: {
    marginTop: 24,
  },
  list: {
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowBody: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textDark,
  },
  description: {
    fontSize: 13,
    color: colors.textGrey,
    marginTop: 2,
  },
});
