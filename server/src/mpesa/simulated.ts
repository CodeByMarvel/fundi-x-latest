import type { Database } from '../db/client';
import { transferSucceeded } from '../money/transfers';
import { simulatorGateway } from './simulator';

/**
 * The simulator wired to this database: a simulated B2C transfer is
 * confirmed by the same code a real Daraja result runs.
 */
export const simulatedMpesa = (db: Database) =>
  simulatorGateway({
    onTransfer: (transferId, conversationId) => {
      const receipt = `S${conversationId.slice(-9).toUpperCase().replace(/[^A-Z0-9]/g, '0')}`;
      transferSucceeded(db, { transferId }, receipt).catch(err =>
        console.error('Simulated transfer could not be confirmed', err),
      );
    },
  });
