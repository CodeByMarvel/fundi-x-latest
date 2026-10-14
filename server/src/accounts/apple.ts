import { createRemoteJWKSet, jwtVerify } from 'jose';
import { NotConfiguredError, UnauthenticatedError } from '../errors';

export type AppleIdentity = { subject: string; email?: string };

/** Checks the identity token "Sign in with Apple" hands the iOS app. */
export type AppleVerifier = (identityToken: string) => Promise<AppleIdentity>;

const APPLE_KEYS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

/**
 * The token counts only if Apple's own keys signed it, it was issued for
 * our app (its bundle id), and it hasn't expired. Apple sends the person's
 * name only to the app, once, so the app passes it separately.
 */
export function appleVerifier(bundleId: string | undefined): AppleVerifier {
  if (!bundleId) {
    return async () => {
      throw new NotConfiguredError('Sign in with Apple is not set up: APPLE_BUNDLE_ID is missing');
    };
  }
  return async identityToken => {
    try {
      const { payload } = await jwtVerify(identityToken, APPLE_KEYS, {
        issuer: 'https://appleid.apple.com',
        audience: bundleId,
      });
      if (!payload.sub) {
        throw new Error('No subject');
      }
      return {
        subject: payload.sub,
        ...(typeof payload.email === 'string' && { email: payload.email }),
      };
    } catch {
      throw new UnauthenticatedError();
    }
  };
}
