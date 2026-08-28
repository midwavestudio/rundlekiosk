const CLC_MIN_DIGITS = 6;

/** Trim and validate a CLC number for check-in submission. */
export function normalizeClcNumber(value: unknown): string {
  return String(value ?? '').trim();
}

/** Returns true when the CLC value meets the minimum digit requirement. */
export function isClcNumberLongEnough(value: string): boolean {
  return value.replace(/\D/g, '').length >= CLC_MIN_DIGITS;
}

export function validateClcNumberRequired(
  value: unknown
): { ok: true; clcNumber: string } | { ok: false; error: string } {
  const clcNumber = normalizeClcNumber(value);
  if (!clcNumber) {
    return { ok: false, error: 'CLC Number is required' };
  }
  if (!isClcNumberLongEnough(clcNumber)) {
    return { ok: false, error: `CLC Number must be at least ${CLC_MIN_DIGITS} digits` };
  }
  return { ok: true, clcNumber };
}
