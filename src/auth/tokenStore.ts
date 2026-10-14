import * as Keychain from 'react-native-keychain';

/**
 * The session token lives in the phone's secure storage (Android Keystore,
 * iOS Keychain), never in plain app storage, and only on this device.
 */
const SERVICE = 'fundix.session';

export async function loadToken(): Promise<string | null> {
  const saved = await Keychain.getGenericPassword({ service: SERVICE });
  return saved ? saved.password : null;
}

export async function saveToken(token: string) {
  await Keychain.setGenericPassword('session', token, {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearToken() {
  await Keychain.resetGenericPassword({ service: SERVICE });
}
