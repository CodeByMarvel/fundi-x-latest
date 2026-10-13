import { randomUUID } from 'node:crypto';

/** Ids carry a prefix so a stray one in a log says what it is: job_…, evt_… */
export const newId = (prefix: string) => `${prefix}_${randomUUID()}`;
