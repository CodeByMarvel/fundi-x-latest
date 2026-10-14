/**
 * The sign-in flow against a pretend server: Google's picker is the
 * library's own test stand-in, secure storage is in memory (jest.setup.js).
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import App from '../App';

jest.mock('../src/config', () => ({ config: { apiUrl: 'http://fundix.test' } }));
// Draws its children at once instead of after measuring the screen.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

type Account = {
  id: string;
  role: 'customer' | 'provider';
  name: string;
  email: string;
  phone: string | null;
  phoneVerified: boolean;
  provider: null | object;
  nextStep: 'add_phone' | 'provider_profile' | null;
};

const newAccount = (role: Account['role']): Account => ({
  id: 'usr_1',
  role,
  name: 'Amina Odhiambo',
  email: 'amina@gmail.com',
  phone: null,
  phoneVerified: false,
  provider: null,
  nextStep: 'add_phone',
});

/** A pretend Fundi-X server: answers by path, records what it was sent. */
function server(routes: Record<string, (body: any) => { status?: number; json: unknown }>) {
  const calls: { path: string; body: any; auth?: string }[] = [];
  globalThis.fetch = jest.fn(async (url: string, init: any = {}) => {
    const path = `${init.method ?? 'GET'} ${url.replace('http://fundix.test', '')}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body, auth: init.headers?.authorization });
    const route = routes[path];
    const answer = route ? route(body) : { status: 404, json: { error: 'not_found' } };
    return {
      ok: (answer.status ?? 200) < 400,
      status: answer.status ?? 200,
      json: async () => answer.json,
    };
  }) as any;
  return calls;
}

let tree: ReactTestRenderer.ReactTestRenderer;

async function start() {
  await act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });
}

const text = () => JSON.stringify(tree.toJSON());

/** Presses the innermost button (or radio) with this label or text. */
async function press(label: string) {
  const matches = tree.root.findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      (n.props.accessibilityLabel === label ||
        n.findAll(c => c.props.children === label).length > 0),
  );
  const target = matches.at(-1);
  if (!target) {
    throw new Error(`No button "${label}"`);
  }
  await act(async () => {
    await target.props.onPress();
  });
}

async function type(placeholder: string, value: string) {
  const input = tree.root.find(n => n.props.placeholder === placeholder && n.props.onChangeText);
  await act(async () => {
    input.props.onChangeText(value);
  });
}

beforeEach(async () => {
  await Keychain.resetGenericPassword();
});
afterEach(() => {
  act(() => tree?.unmount());
});

test('a new customer signs in with Google, adds a phone number, and reaches the app', async () => {
  const calls = server({
    'GET /auth/config': () => ({ json: { googleClientId: 'web-client', appleEnabled: false } }),
    'POST /auth/google': () => ({ json: { token: 'tok_1', account: newAccount('customer') } }),
    'PUT /me/phone': ({ phone }) => ({
      json: { ...newAccount('customer'), phone: phone.replace(/^0/, '254').replace(/\s/g, ''), nextStep: null },
    }),
  });
  await start();
  expect(text()).toContain('Welcome to Fundi-X');

  await press('Continue with Google');
  expect(calls.find(c => c.path === 'POST /auth/google')?.body).toEqual({
    credential: 'mockIdToken', // what Google's picker returned
    role: 'customer',
  });
  expect(text()).toContain('Your M-Pesa number');

  await type('0712 345 678', '0712 345 678');
  await press('Continue');
  expect(calls.find(c => c.path === 'PUT /me/phone')?.auth).toBe('Bearer tok_1');
  expect(text()).not.toContain('Your M-Pesa number');
  expect(text()).not.toContain('Welcome to Fundi-X');

  // The session is kept in secure storage for next time.
  expect(await Keychain.getGenericPassword()).toMatchObject({ password: 'tok_1' });
});

test('a mechanic is asked for their work profile after the phone number', async () => {
  server({
    'GET /auth/config': () => ({ json: { googleClientId: 'web-client', appleEnabled: false } }),
    'POST /auth/google': () => ({ json: { token: 'tok_2', account: newAccount('provider') } }),
    'PUT /me/phone': () => ({
      json: { ...newAccount('provider'), phone: '254722000111', nextStep: 'provider_profile' },
    }),
  });
  await start();
  await press("I'm a mechanic or garage");
  await press('Continue with Google');
  await type('0712 345 678', '0722000111');
  await press('Continue');
  expect(text()).toContain('Tell us about your work');
});

test('a saved session goes straight to the app; one the server refuses is cleared', async () => {
  await Keychain.setGenericPassword('session', 'tok_saved');
  server({ 'GET /me': () => ({ json: { ...newAccount('customer'), phone: '254712345678', nextStep: null } }) });
  await start();
  expect(text()).not.toContain('Welcome to Fundi-X');
  act(() => tree.unmount());

  server({ 'GET /me': () => ({ status: 401, json: { error: 'unauthenticated' } }) });
  await start();
  expect(text()).toContain('Welcome to Fundi-X');
  expect(await Keychain.getGenericPassword()).toBe(false);
});

test('explains when Google sign-in is not set up on the server', async () => {
  server({ 'GET /auth/config': () => ({ json: { googleClientId: null, appleEnabled: false } }) });
  await start();
  await press('Continue with Google');
  expect(text()).toContain('Google sign-in is not set up on the server yet.');
});
