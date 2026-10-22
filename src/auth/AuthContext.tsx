import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { selectMockBackend, selectServerBackend } from '../data/backend';
import { Account, AccountRole, authApi, ServerError } from './api';
import { googleCredential } from './google';
import { clearToken, loadToken, saveToken } from './tokenStore';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; token: string; account: Account }
  /** DEVELOPMENT ONLY: the app on its mock data, without signing in. */
  | { status: 'demo' };

type AuthValue = {
  state: AuthState;
  /** Resolves false if the person backed out of Google's picker. */
  signInWithGoogle: (role: AccountRole) => Promise<boolean>;
  setPhone: (phone: string) => Promise<void>;
  setProviderProfile: (profile: {
    type: 'mechanic' | 'garage';
    businessName?: string;
    specialty: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  enterDemo: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Who is signed in, kept for the whole app. On start it reads the saved
 * session from secure storage and asks the server who it belongs to; a
 * session the server no longer accepts (signed out elsewhere, account
 * suspended or deleted) sends the person back to sign-in.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await loadToken();
      if (!token) {
        if (!cancelled) setState({ status: 'signedOut' });
        return;
      }
      try {
        const account = await authApi.me(token);
        if (!cancelled) setState({ status: 'signedIn', token, account });
      } catch (err) {
        // Offline is not signed out: keep the session and try again later.
        if (err instanceof ServerError && (err.status === 401 || err.status === 403)) {
          await clearToken();
        }
        if (!cancelled) setState({ status: 'signedOut' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The server's data only once the account is complete: until the phone
  // (and a mechanic's profile) is in, the server refuses job calls.
  const token = state.status === 'signedIn' ? state.token : null;
  const ready = state.status === 'signedIn' && state.account.nextStep === null;
  const backendToken = ready ? token : null;
  const accountRole = ready ? state.account.role : null;

  // Signed in: the app's data comes from the server, as this account.
  // Otherwise the simulation (demo mode). Layout effect: switched before
  // any screen's own effects start loading data.
  useLayoutEffect(() => {
    if (backendToken && accountRole) {
      selectServerBackend(backendToken, accountRole);
    } else {
      selectMockBackend();
    }
  }, [backendToken, accountRole]);

  const signInWithGoogle = useCallback(async (role: AccountRole) => {
    const { googleClientId } = await authApi.config();
    if (!googleClientId) {
      throw new ServerError(503, 'not_configured', 'Google sign-in is not set up on the server yet.');
    }
    const credential = await googleCredential(googleClientId);
    if (!credential) {
      return false;
    }
    const signedIn = await authApi.signInWithGoogle(credential, role);
    await saveToken(signedIn.token);
    setState({ status: 'signedIn', token: signedIn.token, account: signedIn.account });
    return true;
  }, []);

  /** Runs an account change and shows the account the server sends back. */
  const update = useCallback(
    async (change: (t: string) => Promise<Account>) => {
      if (!token) {
        throw new ServerError(401, 'unauthenticated', 'Sign in first');
      }
      const account = await change(token);
      setState({ status: 'signedIn', token, account });
    },
    [token],
  );

  const endSession = useCallback(async () => {
    await clearToken();
    setState({ status: 'signedOut' });
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      state,
      signInWithGoogle,
      setPhone: phone => update(t => authApi.setPhone(t, phone)),
      setProviderProfile: profile => update(t => authApi.setProviderProfile(t, profile)),
      signOut: async () => {
        if (token) {
          await authApi.signOut(token).catch(() => {}); // signed out locally either way
        }
        await endSession();
      },
      deleteAccount: async () => {
        if (token) {
          await authApi.deleteAccount(token);
        }
        await endSession();
      },
      enterDemo: () => {
        if (__DEV__) {
          setState({ status: 'demo' });
        }
      },
    }),
    [state, signInWithGoogle, update, token, endSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
