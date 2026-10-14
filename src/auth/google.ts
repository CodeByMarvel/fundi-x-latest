import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';

/**
 * Shows Google's account picker and returns the signed credential (ID
 * token) for our server to check, or null if the person backed out.
 * `webClientId` comes from the server, so the app holds no Google settings.
 */
export async function googleCredential(webClientId: string): Promise<string | null> {
  GoogleSignin.configure({ webClientId });
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Always show the picker, so people can choose another account.
    await GoogleSignin.signOut().catch(() => {});
    const response = await GoogleSignin.signIn();
    if (isCancelledResponse(response)) {
      return null;
    }
    if (!response.data.idToken) {
      throw new Error('Google returned no credential');
    }
    return response.data.idToken;
  } catch (err) {
    if (isErrorWithCode(err) && err.code === statusCodes.IN_PROGRESS) {
      return null; // a sign-in is already open
    }
    if (isErrorWithCode(err) && err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new Error('Google Play services are needed to sign in with Google.');
    }
    throw err;
  }
}
