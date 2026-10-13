import { createRemoteJWKSet, jwtVerify } from 'jose';
import { NotConfiguredError, UnauthenticatedError } from '../errors';

/** Who Google says signed in. */
export type GoogleIdentity = {
  email: string;
  /** Google's permanent account id ("sub"); unlike an email, never reused. */
  subject: string;
  name?: string;
};

/**
 * Checks the credential the "Sign in with Google" button hands the admin
 * website, and says whose it is. Passed into the app so tests can use a
 * fake one; Google is only ever called from here.
 */
export type GoogleVerifier = (credential: string) => Promise<GoogleIdentity>;

const GOOGLE_KEYS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

/**
 * The credential is a token signed by Google. It counts only if Google's
 * own keys signed it, it was issued for OUR client id (not some other
 * site's), it hasn't expired, and Google has verified the email.
 */
export function googleVerifier(clientId: string | undefined): GoogleVerifier {
  if (!clientId) {
    return async () => {
      throw new NotConfiguredError(
        'Google sign-in is not set up: GOOGLE_CLIENT_ID is missing',
      );
    };
  }
  return async credential => {
    try {
      const { payload } = await jwtVerify(credential, GOOGLE_KEYS, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: clientId,
      });
      if (
        typeof payload.email !== 'string' ||
        payload.email_verified !== true ||
        !payload.sub
      ) {
        throw new Error('No verified email');
      }
      return {
        email: payload.email,
        subject: payload.sub,
        ...(typeof payload.name === 'string' && { name: payload.name }),
      };
    } catch {
      throw new UnauthenticatedError();
    }
  };
}
