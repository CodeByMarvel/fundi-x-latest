/**
 * Smoke tests: drive one job through its whole life on the app's real
 * (mock) backend, and render both sides' screens at every stage. Catches
 * render crashes that only appear in a particular status.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { JobTrackingScreen } from '../src/customer/jobs/JobTrackingScreen';
import { buildCreateJobInput } from '../src/customer/request/engine';
import { EMPTY_DRAFT } from '../src/customer/request/types';
import { ActivityScreen } from '../src/customer/screens/ActivityScreen';
import { HomeScreen as CustomerHome } from '../src/customer/screens/HomeScreen';
import { ServicesScreen } from '../src/customer/screens/ServicesScreen';
import { AccountScreen as CustomerAccount } from '../src/customer/screens/AccountScreen';
import {
  jobRepository,
  paymentService,
  simulatedPhone,
} from '../src/data/backend';
import { MechanicJobScreen } from '../src/mechanic/jobs/MechanicJobScreen';
import { QuoteBuilderScreen } from '../src/mechanic/jobs/QuoteBuilderScreen';
import { EarningsScreen } from '../src/mechanic/screens/EarningsScreen';
import { HomeScreen as MechanicHome } from '../src/mechanic/screens/HomeScreen';
import { JobsScreen } from '../src/mechanic/screens/JobsScreen';
import { AccountScreen as MechanicAccount } from '../src/mechanic/screens/AccountScreen';
import { RoleProvider } from '../src/app/RoleContext';
import { kes } from '../src/domain/money';

const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  replace: jest.fn(),
  popToTop: jest.fn(),
};

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <RoleProvider>
        <SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>
      </RoleProvider>,
    );
  });
  const text = JSON.stringify(tree.toJSON());
  act(() => tree.unmount());
  return text;
}

/** Renders both job screens and returns their text. */
function renderJob(jobId: string) {
  const props = (name: string) => ({
    navigation: mockNavigation as any,
    route: { key: name, name, params: { jobId } } as any,
  });
  return {
    customer: render(<JobTrackingScreen {...props('JobTracking')} />),
    mechanic: render(<MechanicJobScreen {...props('MechanicJob')} />),
  };
}

async function wait(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

/** Runs a backend call, fast-forwarding through its simulated delay. */
async function call<T>(promise: Promise<T>, ms = 1500): Promise<T> {
  await wait(ms);
  return promise;
}

// Rendering every screen at every stage takes a while.
jest.setTimeout(120_000);

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('renders every stage of a job on both sides', async () => {
  const input = buildCreateJobInput(
    {
      ...EMPTY_DRAFT,
      requestType: 'repair',
      vehicleId: 'v1',
      categoryId: 'brakes',
      answers: { 'brakes.symptoms': ['noise'] },
      description: 'Grinding noise',
      drivability: 'caution',
      location: { kind: 'home', label: 'Home', address: 'Kileleshwa' },
      urgency: 'now',
    },
    { id: 'v1', make: 'Toyota', model: 'Fielder', registration: 'KDA 123A' },
  );

  const job = await call(jobRepository.createJob(input), 500);
  expect(renderJob(job.id).customer).toContain('Finding a trusted fundi');

  await wait(1500);
  let screens = renderJob(job.id);
  expect(screens.customer).toContain("We've found a fundi");
  expect(screens.mechanic).toContain('Accept job');
  expect(render(<MechanicHome />)).toContain('Respond within');

  await call(jobRepository.acceptOffer(job.id, 'p1'));
  screens = renderJob(job.id);
  expect(screens.customer).toContain('Brian Otieno');
  expect(screens.mechanic).toContain("I'm on my way");

  await call(jobRepository.startTrip(job.id, 'p1'));
  expect(renderJob(job.id).customer).toContain('Arriving in about');

  await call(jobRepository.markArrived(job.id, 'p1'));
  await call(jobRepository.startInspection(job.id, 'p1'));
  expect(renderJob(job.id).mechanic).toContain('Create quote');
  expect(
    render(
      <QuoteBuilderScreen
        navigation={mockNavigation as any}
        route={
          { key: 'q', name: 'QuoteBuilder', params: { jobId: job.id } } as any
        }
      />,
    ),
  ).toContain('Send quote to customer');

  const quote = await call(
    jobRepository.sendQuote(job.id, 'p1', [
      {
        kind: 'CALL_OUT',
        description: 'Call-out',
        quantity: 1,
        unitPrice: kes(1000),
      },
      {
        kind: 'PART',
        description: 'Brake pads',
        quantity: 1,
        unitPrice: kes(4500),
      },
    ]),
  );
  screens = renderJob(job.id);
  expect(screens.customer).toContain('Approve & start work');
  expect(screens.mechanic).toContain('Awaiting approval');

  await call(jobRepository.approveQuote(job.id, quote.id));
  await call(jobRepository.markWorkComplete(job.id, 'p1', 'New pads fitted'));
  expect(renderJob(job.id).customer).toContain('Report a problem');

  await call(jobRepository.confirmCompletion(job.id));
  expect(renderJob(job.id).customer).toContain('with M-Pesa');

  const payment = await call(
    paymentService.initiatePayment(job.id, '0712345678'),
  );
  expect(renderJob(job.id).customer).toContain('Simulated phone');

  act(() => simulatedPhone.respondToPaymentPrompt(payment.id, 'pay'));
  await wait(2000 + 1000);
  screens = renderJob(job.id);
  expect(screens.customer).toContain('Service completed');
  expect(screens.customer).toContain('M-Pesa code');
  expect(screens.mechanic).toContain('You earn');

  await call(jobRepository.submitRating(job.id, 5, 'Great'));
  expect(renderJob(job.id).customer).toContain('Thanks for your feedback');

  // Lists and tabs on both sides, with a finished job in them.
  expect(render(<CustomerHome />)).toContain('Recent service');
  expect(render(<ActivityScreen />)).toContain('Past');
  expect(render(<ServicesScreen />)).toContain('Brake service');
  expect(render(<CustomerAccount />)).toContain('My vehicles');
  expect(render(<JobsScreen />)).toContain('History');
  expect(render(<EarningsScreen />)).toContain('Payments');
  expect(render(<MechanicAccount />)).toContain('rating');
});

it('explains a cancelled job on both sides', async () => {
  const input = buildCreateJobInput(
    {
      ...EMPTY_DRAFT,
      requestType: 'service',
      vehicleId: 'v1',
      categoryId: 'oil_service',
      drivability: 'safe',
      location: { kind: 'home', label: 'Home', address: 'Kileleshwa' },
      urgency: 'today',
    },
    { id: 'v1', make: 'Toyota', model: 'Fielder', registration: 'KDA 123A' },
  );
  const job = await call(jobRepository.createJob(input), 500);
  await wait(1500);
  await call(jobRepository.acceptOffer(job.id, 'p1'));
  await call(jobRepository.providerCancelJob(job.id, 'p1', 'Flat tyre'));

  const screens = renderJob(job.id);
  expect(screens.customer).toContain('Your fundi had to cancel');
  expect(screens.customer).toContain('Find another fundi');
  expect(screens.customer).toContain('Flat tyre');
  expect(screens.mechanic).toContain('You cancelled this job');
});
