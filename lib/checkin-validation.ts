/** Trim and validate a CLC number for check-in submission. */
export function normalizeClcNumber(value: unknown): string {
  return String(value ?? '').trim();
}

export function validateClcNumberRequired(
  value: unknown
): { ok: true; clcNumber: string } | { ok: false; error: string } {
  const clcNumber = normalizeClcNumber(value);
  if (!clcNumber) {
    return { ok: false, error: 'CLC Number is required' };
  }
  return { ok: true, clcNumber };
}
