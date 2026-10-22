import { useAuth } from '../../auth/AuthContext';
import { formatPhone } from '../../domain/billing/types';
import { customer as demoCustomer } from './mockHome';
import { useSavedPlaces } from './places';

/**
 * The customer's name and contact for the home, account and payment
 * screens: the signed-in account (GET /me), or in demo mode the sample
 * customer. Their area is their saved Home, if they have one.
 */
export function useCustomerProfile() {
  const { state } = useAuth();
  const { home } = useSavedPlaces();
  if (state.status !== 'signedIn') {
    return demoCustomer;
  }
  const { name, email, phone } = state.account;
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return {
    firstName: firstName ?? '',
    lastName: rest.join(' '),
    location: home?.address ?? '',
    /** Prefills M-Pesa payments; empty until they add a phone. */
    mpesaPhone: phone ? formatPhone(phone) : '',
    email: email ?? '',
  };
}
