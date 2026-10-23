/**
 * Smoke tests: drive jobs through their whole lives on the app's real
 * (mock) backend, and render both sides' screens at every stage. Catches
 * render crashes that only appear in a particular status.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RoleProvider } from '../src/app/RoleContext';
import { AuthProvider } from '../src/auth/AuthContext';
import { JobTrackingScreen } from '../src/customer/jobs/JobTrackingScreen';
import { buildJobDetails } from '../src/customer/request/engine';
import { EMPTY_DRAFT } from '../src/customer/request/types';
import { AccountScreen as CustomerAccount } from '../src/customer/screens/AccountScreen';
import { ActivityScreen } from '../src/customer/screens/ActivityScreen';
import { HomeScreen as CustomerHome } from '../src/customer/screens/HomeScreen';
import { ServicesScreen } from '../src/customer/screens/ServicesScreen';
import {
  billingService,
  jobRepository,
  simulatedPhone,
} from '../src/data/backend';
import { calculateEstimate } from '../src/domain/pricing/engine';
import { JobRequestDetails } from '../src/domain/jobs/types';
import { LATE_GRACE_MS } from '../src/domain/jobs/rules';
import { line } from '../src/domain/quotes/quotes';
import { MechanicJobScreen } from '../src/mechanic/jobs/MechanicJobScreen';
import { QuoteBuilderScreen } from '../src/mechanic/jobs/QuoteBuilderScreen';
import { AccountScreen as MechanicAccount } from '../src/mechanic/screens/AccountScreen';
import { EarningsScreen } from '../src/mechanic/screens/EarningsScreen';
import { HomeScreen as MechanicHome } from '../src/mechanic/screens/HomeScreen';
import { JobsScreen } from '../src/mechanic/screens/JobsScreen';

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
      <AuthProvider>
        <RoleProvider>
          <SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>
        </RoleProvider>
      </AuthProvider>,
    );
  });
  const text = JSON.stringify(tree.toJSON());
  act(() => tree.unmount());
  return text;
}

const props = (name: string, params: object) => ({
  navigation: mockNavigation as any,
  route: { key: name, name, params } as any,
});

/** Renders both job screens and returns their text. */
function renderJob(jobId: string) {
  return {
    customer: render(
      <JobTrackingScreen {...props('JobTracking', { jobId })} />,
    ),
    mechanic: render(
      <MechanicJobScreen {...props('MechanicJob', { jobId })} />,
    ),
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

const vehicle = {
  id: 'v1',
  make: 'Toyota',
  model: 'Fielder',
  registration: 'KDA 123A',
};
const REPAIR = buildJobDetails(
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
  vehicle,
);
const SERVICE: JobRequestDetails = {
  ...REPAIR,
  requestType: 'service',
  categoryId: 'oil_service',
  answers: {},
  description: '',
  // Not one of the customer's saved cars.
  vehicle: { ...vehicle, id: 'new-1', registration: 'KDB 999X' },
};

function book(details: JobRequestDetails) {
  const estimate = calculateEstimate(details);
  return call(
    jobRepository.createJob({
      ...details,
      acceptedPrice: {
        callOut: estimate.callOut,
        fixedServiceTotal: estimate.fixedService?.total,
      },
    }),
    500,
  );
}

/** Pays whatever the job is waiting for, via the simulated phone. */
async function pay(jobId: string) {
  const payment = await call(
    billingService.initiatePayment(jobId, '0712345678'),
  );
  act(() => simulatedPhone.respondToPaymentPrompt(payment.id, 'pay'));
  await wait(2000);
}

/** Books, pays the call-out, and lets matching offer the job to p1. */
async function offered(details: JobRequestDetails) {
  const job = await book(details);
  await pay(job.id);
  await wait(1500);
  return job;
}

// Rendering every screen at every stage takes a while.
jest.setTimeout(120_000);

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('renders every stage of a repair on both sides', async () => {
  const job = await book(REPAIR);
  let screens = renderJob(job.id);
  expect(screens.customer).toContain('Pay the call-out to book');
  expect(screens.customer).toContain('Call-out (transport & inspection)');

  const payment = await call(
    billingService.initiatePayment(job.id, '0712345678'),
  );
  expect(renderJob(job.id).customer).toContain('Simulated phone');
  act(() => simulatedPhone.respondToPaymentPrompt(payment.id, 'pay'));
  await wait(2000);
  expect(renderJob(job.id).customer).toContain('Finding a trusted fundi');

  await wait(1500);
  screens = renderJob(job.id);
  expect(screens.customer).toContain("We've found a fundi");
  expect(screens.mechanic).toContain('Accept job');
  expect(render(<MechanicHome />)).toContain('Respond within');

  await call(jobRepository.acceptOffer(job.id, 'p1'));
  screens = renderJob(job.id);
  expect(screens.customer).toContain('Brian Otieno');
  expect(screens.mechanic).toContain("I'm on my way");
  expect(screens.mechanic).toContain('Withdraw from job');

  await call(jobRepository.startTrip(job.id, 'p1'));
  expect(renderJob(job.id).customer).toContain('Arriving in about');

  await call(jobRepository.markArrived(job.id, 'p1'));
  screens = renderJob(job.id);
  expect(screens.mechanic).toContain('Start inspection');
  expect(screens.mechanic).toContain('Customer not here?');

  await call(jobRepository.startInspection(job.id, 'p1'));
  expect(renderJob(job.id).mechanic).toContain('Create quote');
  const builder = render(
    <QuoteBuilderScreen
      {...props('QuoteBuilder', { jobId: job.id, mode: 'base' })}
    />,
  );
  expect(builder).toContain('Send quote to customer');
  // Standard service codes to pick from.
  expect(builder).toContain('Diagnostics');

  const quote = await call(
    jobRepository.sendQuote(job.id, 'p1', [line('BRAKE_PAD_FRONT', 4500)]),
  );
  screens = renderJob(job.id);
  expect(screens.customer).toContain('Approve & start repair');
  expect(screens.mechanic).toContain('Awaiting approval');

  await call(jobRepository.approveQuote(job.id, quote.id));
  screens = renderJob(job.id);
  expect(screens.customer).toContain('Pay to start');
  expect(screens.customer).toContain('The parts money goes to your fundi now');
  expect(screens.mechanic).toContain('Don’t start work yet');

  await pay(job.id);
  expect(renderJob(job.id).mechanic).toContain('Found extra work? Quote it');
  expect(
    render(
      <QuoteBuilderScreen
        {...props('QuoteBuilder', { jobId: job.id, mode: 'additional' })}
      />,
    ),
  ).toContain('Why is this needed?');

  await call(jobRepository.markWorkComplete(job.id, 'p1', 'New pads fitted'));
  screens = renderJob(job.id);
  expect(screens.customer).toContain('Report a problem');
  expect(screens.customer).toContain('release payment');

  await call(jobRepository.confirmCompletion(job.id));
  screens = renderJob(job.id);
  expect(screens.customer).toContain('Service completed');
  expect(screens.customer).toContain('Total paid');
  expect(screens.customer).not.toContain('Keep this car?'); // already saved
  expect(screens.mechanic).toContain('You earn');

  await call(jobRepository.submitRating(job.id, 5, 'Great'));
  expect(renderJob(job.id).customer).toContain('Thanks for your feedback');

  // Lists and tabs on both sides, with a finished job in them.
  expect(render(<CustomerHome />)).toContain('Recent service');
  expect(render(<ActivityScreen />)).toContain('Past');
  expect(render(<ServicesScreen />)).toContain('Brake service');
  expect(render(<CustomerAccount />)).toContain('My vehicles');
  expect(render(<JobsScreen />)).toContain('History');
  expect(render(<EarningsScreen />)).toContain('Payouts');
  expect(render(<MechanicAccount />)).toContain('Reliability');
});

it('renders a fixed-price service with extra work on both sides', async () => {
  const booked = await book(SERVICE);
  expect(renderJob(booked.id).customer).toContain('Your fixed-price service');

  await pay(booked.id);
  await wait(1500);
  await call(jobRepository.acceptOffer(booked.id, 'p1'));
  await call(jobRepository.startTrip(booked.id, 'p1'));
  await call(jobRepository.markArrived(booked.id, 'p1'));
  expect(renderJob(booked.id).mechanic).toContain('Ready to start');

  await call(jobRepository.readyToStart(booked.id, 'p1'));
  let screens = renderJob(booked.id);
  expect(screens.customer).toContain('Pay to start');
  expect(screens.mechanic).toContain('Waiting for payment');

  await pay(booked.id);
  expect(renderJob(booked.id).mechanic).toContain('Fixed by Fundi-X');

  const extra = await call(
    jobRepository.raiseAdditionalQuote(
      booked.id,
      'p1',
      [line('WIPER_BLADE', 600, 2)],
      'Wiper blades are split',
    ),
  );
  screens = renderJob(booked.id);
  expect(screens.customer).toContain('Approve & pay');
  expect(screens.mechanic).toContain('Waiting for the customer to answer');

  await call(jobRepository.rejectQuote(booked.id, extra.id));
  screens = renderJob(booked.id);
  expect(screens.customer).toContain('Extra work you declined');
  expect(screens.mechanic).not.toContain('Waiting for the customer to answer');

  // Leave p1 free for the next test.
  await call(jobRepository.markWorkComplete(booked.id, 'p1', ''));
  await call(jobRepository.confirmCompletion(booked.id));
  // A car that isn't in My vehicles: offered for next time.
  expect(renderJob(booked.id).customer).toContain('Keep this car?');
});

it('explains a withdrawal and a refunded cancellation', async () => {
  const job = await offered(REPAIR);
  await call(jobRepository.acceptOffer(job.id, 'p1'));
  await call(jobRepository.startTrip(job.id, 'p1'));
  await call(jobRepository.withdrawFromJob(job.id, 'p1', 'Flat tyre'));

  let screens = renderJob(job.id);
  expect(screens.customer).toContain('Finding you another fundi');
  expect(screens.mechanic).toContain('no longer available');

  await call(jobRepository.cancelJob(job.id));
  screens = renderJob(job.id);
  expect(screens.customer).toContain('You cancelled this request');
  expect(screens.customer).toContain('Refund of');
});

it('offers a full refund when the fundi is late', async () => {
  const job = await offered(REPAIR);
  await call(jobRepository.acceptOffer(job.id, 'p1'));
  const enRoute = await call(jobRepository.startTrip(job.id, 'p1'));
  expect(renderJob(job.id).customer).not.toContain('running late');

  await wait(
    Date.parse(enRoute.expectedArrivalAt!) + LATE_GRACE_MS + 1000 - Date.now(),
  );
  expect(renderJob(job.id).customer).toContain('running late');

  await call(jobRepository.cancelJob(job.id));
  const screens = renderJob(job.id);
  expect(screens.customer).toContain('Your fundi was late');
  expect(screens.customer).toContain('Refund of');
  expect(screens.mechanic).toContain('because you were late');
});

it('explains a declined estimate on both sides', async () => {
  const job = await offered(REPAIR);
  await call(jobRepository.acceptOffer(job.id, 'p1'));
  await call(jobRepository.startTrip(job.id, 'p1'));
  await call(jobRepository.markArrived(job.id, 'p1'));
  await call(jobRepository.startInspection(job.id, 'p1'));
  const quote = await call(
    jobRepository.sendQuote(job.id, 'p1', [line('LABOUR_GENERAL', 3000)]),
  );
  await call(jobRepository.rejectQuote(job.id, quote.id));

  const screens = renderJob(job.id);
  expect(screens.customer).toContain('You declined the estimate');
  expect(screens.customer).toContain("isn't refundable");
  expect(screens.mechanic).toContain('You keep the call-out');
  expect(screens.mechanic).toContain('You earn');
});
