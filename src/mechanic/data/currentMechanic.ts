import { useAuth } from '../../auth/AuthContext';

/**
 * Who the mechanic side is acting as: the signed-in account, or in demo
 * mode the simulation's Brian (p1).
 */

const DEMO_PROVIDER_ID = 'p1';

const demoProfile = {
  firstName: 'Brian',
  lastName: 'Otieno',
  location: 'Kilimani, Nairobi',
  email: 'brian@example.com',
};

export function useCurrentProviderId() {
  const { state } = useAuth();
  return state.status === 'signedIn' ? state.account.id : DEMO_PROVIDER_ID;
}

/** Name and contact for the header and account screens. */
export function useMechanicProfile() {
  const { state } = useAuth();
  if (state.status !== 'signedIn') {
    return demoProfile;
  }
  const { name, email } = state.account;
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return {
    firstName: firstName ?? '',
    lastName: rest.join(' '),
    // Their area isn't asked for yet; the server matches on live position.
    location: 'Nairobi',
    email: email ?? '',
  };
}
