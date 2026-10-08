import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { jobRepository } from '../../data/jobRepository';
import { colors } from '../../shared/theme/colors';
import { mockVehicles } from '../data/mockVehicles';
import type { CustomerStackParamList } from '../navigation/CustomerNavigator';
import { RequestHeader } from './components/RequestHeader';
import { QUESTIONS } from './data/questions';
import {
  applyChange,
  buildCreateJobInput,
  getNextStep,
  getSteps,
  questionIdOf,
  STAGE_COUNT,
  stageOf,
  StepKey,
} from './engine';
import { CategoryStep } from './steps/CategoryStep';
import { DescriptionStep } from './steps/DescriptionStep';
import { DrivabilityStep } from './steps/DrivabilityStep';
import { LocationStep } from './steps/LocationStep';
import { MediaStep } from './steps/MediaStep';
import { NeedStep } from './steps/NeedStep';
import { QuestionStep } from './steps/QuestionStep';
import { ReviewStep } from './steps/ReviewStep';
import { UrgencyStep } from './steps/UrgencyStep';
import { VehicleStep } from './steps/VehicleStep';
import { EMPTY_DRAFT, RequestDraft, Vehicle } from './types';

type Props = NativeStackScreenProps<CustomerStackParamList, 'RequestFlow'>;

export function RequestFlowScreen({ navigation }: Props) {
  const { top } = useSafeAreaInsets();
  const [draft, setDraft] = useState<RequestDraft>(EMPTY_DRAFT);
  const [history, setHistory] = useState<StepKey[]>(['need']);
  const [editingFromReview, setEditingFromReview] = useState(false);
  // TODO: load from and save to the customer's garage on the backend.
  const [vehicles, setVehicles] = useState<Vehicle[]>(mockVehicles);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const step = history[history.length - 1];
  const vehicle = vehicles.find(v => v.id === draft.vehicleId);

  const goTo = (target: StepKey) => {
    // Revisiting a step (e.g. returning to review) rewinds history to it.
    setHistory(h => {
      const i = h.indexOf(target);
      return i >= 0 ? h.slice(0, i + 1) : [...h, target];
    });
    if (target === 'review') {
      setEditingFromReview(false);
    }
  };

  const onChange = (patch: Partial<RequestDraft>) =>
    setDraft(d => applyChange(d, patch));

  const onNext = (patch: Partial<RequestDraft> = {}) => {
    const nextDraft = applyChange(draft, patch);
    setDraft(nextDraft);
    goTo(getNextStep(nextDraft, step, editingFromReview));
  };

  const onEdit = (target: StepKey) => {
    setEditingFromReview(true);
    setHistory(h => [...h, target]);
  };

  const exit = () => {
    // The request is already on its way; leaving now would orphan the job.
    if (submittingRef.current) {
      return;
    }
    if (!draft.requestType) {
      navigation.goBack();
      return;
    }
    Alert.alert('Cancel this request?', 'Your answers will be lost.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Cancel request',
        style: 'destructive',
        onPress: () => navigation.goBack(),
      },
    ]);
  };

  const goBack = () => {
    if (submittingRef.current) {
      return;
    }
    // Skip steps that an answer change has since removed from the flow.
    const valid = getSteps(draft);
    const prev = history.slice(0, -1);
    while (prev.length > 0 && !valid.includes(prev[prev.length - 1])) {
      prev.pop();
    }
    if (prev.length === 0) {
      exit();
      return;
    }
    setHistory(prev);
    if (prev[prev.length - 1] === 'review') {
      setEditingFromReview(false);
    }
  };

  // Android back button steps back through the flow instead of leaving it.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goBack();
      return true;
    });
    return () => sub.remove();
  });

  const submit = async () => {
    // A ref, not state: two taps in the same frame would both still read the
    // old `submitting` state, and we'd create the job twice.
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const job = await jobRepository.createJob(
        buildCreateJobInput(draft, vehicle),
      );
      navigation.replace('RequestSubmitted', { jobId: job.id });
    } catch {
      submittingRef.current = false;
      setSubmitting(false);
      Alert.alert("Couldn't send your request", 'Please try again.');
    }
  };

  const renderStep = () => {
    const props = { draft, onChange, onNext };

    const questionId = questionIdOf(step);
    if (questionId) {
      return <QuestionStep {...props} question={QUESTIONS[questionId]} />;
    }

    switch (step) {
      case 'need':
        return <NeedStep {...props} />;
      case 'vehicle':
        return (
          <VehicleStep
            {...props}
            vehicles={vehicles}
            onAddVehicle={v => setVehicles(list => [...list, v])}
          />
        );
      case 'category':
        return <CategoryStep {...props} />;
      case 'description':
        return <DescriptionStep {...props} />;
      case 'media':
        return <MediaStep {...props} />;
      case 'drivability':
        return <DrivabilityStep {...props} />;
      case 'location':
        return <LocationStep {...props} />;
      case 'urgency':
        return <UrgencyStep {...props} />;
      case 'review':
        return (
          <ReviewStep
            draft={draft}
            vehicle={vehicle}
            onEdit={onEdit}
            onSubmit={submit}
            submitting={submitting}
          />
        );
    }
  };

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.screen, { paddingTop: top }]}
    >
      <RequestHeader
        stage={stageOf(step)}
        stageCount={STAGE_COUNT}
        onBack={goBack}
        onClose={exit}
      />
      {/* Keyed so each step starts with fresh local state. */}
      <View key={step} style={styles.step}>
        {renderStep()}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  step: {
    flex: 1,
  },
});
