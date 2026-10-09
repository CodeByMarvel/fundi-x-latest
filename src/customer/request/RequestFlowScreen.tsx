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
import { jobRepository, pricingService } from '../../data/backend';
import {
  PriceChangedError,
  PriceEstimate,
} from '../../domain/pricing/PricingService';
import { colors } from '../../shared/theme/colors';
import { mockVehicles } from '../data/mockVehicles';
import type { CustomerStackParamList } from '../navigation/CustomerNavigator';
import { RequestHeader } from './components/RequestHeader';
import { QUESTIONS } from './data/questions';
import {
  applyChange,
  buildJobDetails,
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

export function RequestFlowScreen({ navigation, route }: Props) {
  const { top } = useSafeAreaInsets();
  const preset = route.params;
  // Arriving with a category chosen skips "what do you need?"; the category
  // step still shows later so it can be changed.
  const [draft, setDraft] = useState<RequestDraft>(() =>
    preset ? applyChange(EMPTY_DRAFT, preset) : EMPTY_DRAFT,
  );
  const [history, setHistory] = useState<StepKey[]>(
    preset ? ['vehicle'] : ['need'],
  );
  const [editingFromReview, setEditingFromReview] = useState(false);
  // TODO: load from and save to the customer's garage on the backend.
  const [vehicles, setVehicles] = useState<Vehicle[]>(mockVehicles);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const [estimate, setEstimate] = useState<PriceEstimate>();
  const [estimateFailed, setEstimateFailed] = useState(false);
  /** Bumped to ask for the price again. */
  const [priceRequest, setPriceRequest] = useState(0);

  const step = history[history.length - 1];
  const vehicle = vehicles.find(v => v.id === draft.vehicleId);

  // Ask Fundi-X for the price whenever the review step shows (or the request
  // changed). `active` drops answers that arrive after the customer moved on,
  // so a slow, outdated price can never overwrite a newer one.
  useEffect(() => {
    if (step !== 'review') {
      return;
    }
    let active = true;
    setEstimate(undefined);
    setEstimateFailed(false);
    pricingService
      .estimate(buildJobDetails(draft, vehicle))
      .then(result => active && setEstimate(result))
      .catch(() => active && setEstimateFailed(true));
    return () => {
      active = false;
    };
  }, [step, draft, vehicle, priceRequest]);

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
    if (submittingRef.current || !estimate) {
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);

    try {
      // Send back the prices the customer saw, so the backend can refuse
      // the booking if they've changed since.
      const job = await jobRepository.createJob({
        ...buildJobDetails(draft, vehicle),
        acceptedPrice: {
          callOut: estimate.callOut,
          fixedServiceTotal: estimate.fixedService?.total,
        },
      });
      // Next stop: paying the call-out, on the job's own screen.
      navigation.replace('JobTracking', { jobId: job.id });
    } catch (error) {
      submittingRef.current = false;
      setSubmitting(false);
      if (error instanceof PriceChangedError) {
        setPriceRequest(n => n + 1);
        Alert.alert(
          'The price has been updated',
          'Please check the new price before booking.',
        );
      } else {
        Alert.alert("Couldn't book your request", 'Please try again.');
      }
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
            estimate={estimate}
            estimateFailed={estimateFailed}
            onRetryEstimate={() => setPriceRequest(n => n + 1)}
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
