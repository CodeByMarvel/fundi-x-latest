import { API_URL } from '@env';

/**
 * The app's settings, from .env at bundle time (see .env.example). One
 * place, so nothing else imports '@env' and tests can replace it.
 */
export const config = {
  /** The Fundi-X server, e.g. http://10.0.2.2:3000 in the Android emulator. */
  apiUrl: API_URL ?? null,
};
