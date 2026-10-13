import { BadRequestError } from '../errors';

/** Body schema for an intervention's reason (checked again by `reasonFrom`). */
export const reasonSchema = { type: 'string', maxLength: 500 } as const;

/**
 * Every intervention needs a reason in words (docs/admin-portal.md §1):
 * at least a few real characters, not just spaces.
 */
export function reasonFrom(text: string | undefined) {
  const reason = text?.trim() ?? '';
  if (reason.length < 5) {
    throw new BadRequestError('Give a reason (at least 5 characters)');
  }
  return reason;
}
