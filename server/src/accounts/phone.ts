/**
 * Kenyan mobile numbers in the one form M-Pesa accepts: 2547XXXXXXXX or
 * 2541XXXXXXXX. People type them every way: 0712 345 678, +254712345678,
 * 712345678. Returns null for anything that isn't a Kenyan mobile number.
 */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  const local = digits.startsWith('254')
    ? digits.slice(3)
    : digits.startsWith('0')
      ? digits.slice(1)
      : digits;
  return /^[17]\d{8}$/.test(local) ? `254${local}` : null;
}
