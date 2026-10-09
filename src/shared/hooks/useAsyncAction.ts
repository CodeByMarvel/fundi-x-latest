import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { JobTransitionError } from '../../domain/jobs/transitions';
import { PaymentError } from '../../domain/billing/types';
import { PriceChangedError } from '../../domain/pricing/PricingService';
import {
  AdditionalQuotePendingError,
  QuoteValidationError,
  StaleQuoteError,
} from '../../domain/quotes/quotes';

/**
 * Runs one backend action at a time from a screen.
 *
 * - `pending` names the running action, so its button can show a spinner.
 * - A ref blocks double taps that land before the re-render disables buttons.
 * - Failures become a friendly alert instead of an unhandled rejection.
 */
export function useAsyncAction<Name extends string>() {
  const [pending, setPending] = useState<Name | null>(null);
  const busy = useRef(false);

  const run = useCallback(
    async (name: Name, action: () => Promise<unknown>): Promise<boolean> => {
      if (busy.current) {
        return false;
      }
      busy.current = true;
      setPending(name);
      try {
        await action();
        return true;
      } catch (error) {
        Alert.alert(...describeError(error));
        return false;
      } finally {
        busy.current = false;
        setPending(null);
      }
    },
    [],
  );

  return { pending, run };
}

function describeError(error: unknown): [string, string] {
  if (error instanceof JobTransitionError) {
    return [
      'This job has moved on',
      'Something changed while you were looking. The screen now shows the latest status.',
    ];
  }
  if (error instanceof QuoteValidationError || error instanceof PaymentError) {
    return ['Please check', error.message];
  }
  if (error instanceof AdditionalQuotePendingError) {
    return [
      'Waiting for the customer',
      'They need to answer your extra quote before you can finish the job.',
    ];
  }
  if (error instanceof PriceChangedError) {
    return [
      'The price has been updated',
      'Please check the new price and try again.',
    ];
  }
  if (error instanceof StaleQuoteError) {
    return [
      'The quote has changed',
      'Your fundi updated the quote. Please review the new one.',
    ];
  }
  return ['Something went wrong', 'Please try again.'];
}
