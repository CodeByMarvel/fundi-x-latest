import { CalendarDays, Clock, Siren } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { colors } from '../../../shared/theme/colors';
import { OptionCard } from '../components/OptionCard';
import { StepLayout } from '../components/StepLayout';
import { ScheduledFor } from '../types';
import { StepProps } from './stepProps';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const TIME_SLOTS = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'];

function toIsoDate(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** e.g. "Tue 7 Oct" */
export function formatDay(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${DAYS[date.getDay()]} ${d} ${MONTHS[m - 1]}`;
}

/** The next 7 days, starting tomorrow ("Today" has its own option). */
function upcomingDays() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    d.setDate(d.getDate() + i + 1);
    return toIsoDate(d);
  });
}

export function UrgencyStep({ draft, onChange, onNext }: StepProps) {
  const days = useMemo(upcomingDays, []);
  const scheduling = draft.urgency === 'scheduled';
  const [pending, setPending] = useState<Partial<ScheduledFor>>(
    draft.scheduledFor ?? {},
  );

  const pick = (patch: Partial<ScheduledFor>) => {
    const next = { ...pending, ...patch };
    setPending(next);
    // Only store a schedule once both a day and a time are picked.
    onChange({
      scheduledFor:
        next.date && next.time
          ? { date: next.date, time: next.time }
          : undefined,
    });
  };

  return (
    <StepLayout
      title="When do you need help?"
      footer={
        scheduling && (
          <PrimaryButton
            label="Continue"
            disabled={!draft.scheduledFor}
            onPress={() => onNext()}
          />
        )
      }
    >
      <OptionCard
        leading={<Siren color={colors.error} size={22} />}
        label="I need help now"
        description="The vehicle is currently stuck or I need assistance immediately."
        selected={draft.urgency === 'now'}
        onPress={() => onNext({ urgency: 'now' })}
      />
      <OptionCard
        leading={<Clock color={colors.primary} size={22} />}
        label="Today"
        description="I'm looking for help as soon as possible today."
        selected={draft.urgency === 'today'}
        onPress={() => onNext({ urgency: 'today' })}
      />
      <OptionCard
        leading={<CalendarDays color={colors.primary} size={22} />}
        label="Schedule for later"
        description="Choose a date and time."
        selected={scheduling}
        onPress={() => onChange({ urgency: 'scheduled' })}
      />

      {scheduling && (
        <View style={styles.picker}>
          <Text style={styles.pickerLabel}>Day</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {days.map(date => (
              <Chip
                key={date}
                label={formatDay(date)}
                selected={pending.date === date}
                onPress={() => pick({ date })}
              />
            ))}
          </ScrollView>

          <Text style={styles.pickerLabel}>Time</Text>
          <View style={[styles.chips, styles.wrap]}>
            {TIME_SLOTS.map(time => (
              <Chip
                key={time}
                label={time}
                selected={pending.time === time}
                onPress={() => pick({ time })}
              />
            ))}
          </View>
        </View>
      )}
    </StepLayout>
  );
}

type ChipProps = { label: string; selected: boolean; onPress: () => void };

function Chip({ label, selected, onPress }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  picker: {
    marginTop: 8,
    gap: 10,
  },
  pickerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textDark,
  },
  chips: {
    flexDirection: 'row',
    gap: 8,
  },
  wrap: {
    flexWrap: 'wrap',
  },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySurface,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textDark,
  },
  chipTextSelected: {
    color: colors.primary,
  },
});
