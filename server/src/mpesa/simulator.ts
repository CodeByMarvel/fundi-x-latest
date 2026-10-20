import { randomUUID } from 'node:crypto';
import type { MpesaGateway } from './gateway';

/** Simulator ids start with this, so they're never mistaken for real ones. */
export const SIMULATED = 'sim_';

/**
 * Development and tests only: M-Pesa without Safaricom. A PIN prompt is
 * answered from the app's "simulated phone" (POST /dev/payments/:id/respond);
 * B2C transfers are confirmed by `onTransfer`, which the server wires to
 * the same code a real Daraja result runs. Never used in production.
 */
export function simulatorGateway(
  options: { onTransfer?: (transferId: string, conversationId: string) => void } = {},
): MpesaGateway {
  return {
    name: 'simulator',
    async stkPush() {
      return { checkoutRequestId: `${SIMULATED}ws_CO_${randomUUID()}`, merchantRequestId: `${SIMULATED}${randomUUID()}` };
    },
    async stkQuery() {
      return { state: 'PENDING' };
    },
    async b2c({ transferId }) {
      const conversationId = `${SIMULATED}AG_${randomUUID()}`;
      // Like M-Pesa, the result arrives a little later, separately.
      setTimeout(() => options.onTransfer?.(transferId, conversationId), 50);
      return { conversationId };
    },
  };
}
