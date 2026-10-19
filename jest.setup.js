/* eslint-env jest */
/*
 * Stand-ins for native modules, which don't exist under Jest. Google
 * sign-in's own stand-in is loaded by jest.config.js; this is the secure
 * storage, kept in memory.
 */
const mockKeychain = { stored: null };
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
  setGenericPassword: jest.fn(async (_user, password) => {
    mockKeychain.stored = password;
    return true;
  }),
  getGenericPassword: jest.fn(async () =>
    mockKeychain.stored ? { username: 'session', password: mockKeychain.stored } : false,
  ),
  resetGenericPassword: jest.fn(async () => {
    mockKeychain.stored = null;
    return true;
  }),
}));

/** GPS: always at the same spot in Nairobi (Kilimani). */
jest.mock('@react-native-community/geolocation', () => ({
  requestAuthorization: jest.fn(success => success()),
  getCurrentPosition: jest.fn(success =>
    success({ coords: { latitude: -1.2921, longitude: 36.7856 } }),
  ),
  watchPosition: jest.fn(() => 0),
  clearWatch: jest.fn(),
}));
