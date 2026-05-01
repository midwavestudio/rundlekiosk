/**
 * Normalize and dedupe event-log rows for admin UI.
 * Same failure often logs twice (kiosk client `kiosk:*` + route `api:*`) with different JSON shapes.
 */

export interface EventLogEntryLike {
  id: string;
  source: string;
  message: string;
  detailJson?: string;
  occurredAt: string;
}

function decodeBasicEntities(text: string): string {
  return text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function simplifyErrorMessage(message: string): string {
  const msg = decodeBasicEntities(message || '');
  if (!msg) return 'Unexpected system error.';

  const rules: Array<{ pattern: RegExp; replacement: string }> = [
    {
      pattern: /Invalid Parameter Format:\s*rooms\[0\]\[room\s*TypeID\]\s*is required\./i,
      replacement: 'Overbooking: selected room type is unavailable.',
    },
    {
      pattern: /could not accommodate your request|room .* not available|not available for/i,
      replacement: 'Overbooking: selected room is not available.',
    },
    {
      pattern: /remaining balance|collect the full amount|prior to checking in/i,
      replacement: 'Payment required before check-in.',
    },
    {
      pattern: /failed to delete from cloudbeds|cloudbeds delete/i,
      replacement: 'Could not delete reservation in Cloudbeds.',
    },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(msg)) return rule.replacement;
  }
  return msg;
}

function extractReservationFingerprint(ev: EventLogEntryLike): string {
  if (!ev.detailJson) return '';
  try {
    const d = JSON.parse(ev.detailJson) as Record<string, unknown>;
    const sr = d.submittedRequest as Record<string, unknown> | undefined;
    const sg = d.selectedGuest as Record<string, unknown> | undefined;
    const rid =
      (sg?.cloudbedsReservationID != null ? String(sg.cloudbedsReservationID).trim() : '') ||
      (d.reservationID != null ? String(d.reservationID).trim() : '') ||
      (sr?.reservationID != null ? String(sr.reservationID).trim() : '') ||
      (sr?.placeholderReservationID != null ? String(sr.placeholderReservationID).trim() : '') ||
      '';
    return rid;
  } catch {
    return '';
  }
}

function sourceRank(source: string): number {
  return source.startsWith('api:') ? 2 : 1;
}

/** Dedupe list (expects newest-first from API). Prefers `api:*` rows when merging with kiosk duplicates. */
export function dedupeEvents<T extends EventLogEntryLike>(entries: T[]): T[] {
  const byKey = new Map<string, T>();

  for (const ev of entries) {
    const msgNorm = simplifyErrorMessage(ev.message).trim().toLowerCase();
    const rid = extractReservationFingerprint(ev);

    const key =
      rid !== ''
        ? `rid:${rid}:${msgNorm}`
        : `${ev.source}:${msgNorm}:${ev.detailJson ?? ''}`;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, ev);
      continue;
    }

    const preferEv =
      sourceRank(ev.source) > sourceRank(existing.source)
        ? ev
        : sourceRank(ev.source) < sourceRank(existing.source)
          ? existing
          : new Date(ev.occurredAt).getTime() >= new Date(existing.occurredAt).getTime()
            ? ev
            : existing;

    byKey.set(key, preferEv);
  }

  const merged = [...byKey.values()];
  merged.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  return merged;
}
