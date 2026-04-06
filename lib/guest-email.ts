/**
 * Synthetic @guest.com address for kiosk guests. Strips all whitespace from each name part so
 * accidental spaces (e.g. "Kelly ") do not produce invalid emails like "kelly .johnson@guest.com".
 */
export function buildGuestSyntheticEmail(firstName: string, lastName: string): string {
  const localA = String(firstName).trim().replace(/\s+/g, '').toLowerCase();
  const localB = String(lastName).trim().replace(/\s+/g, '').toLowerCase();
  return `${localA}.${localB}@guest.com`;
}
