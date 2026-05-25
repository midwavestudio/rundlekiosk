import { formatCloudbedsRoomNameLabel } from '@/lib/room-display';

export type PickerRoomRow = {
  roomID: string;
  roomName: string;
  roomTypeName: string;
  placeholderReservationID?: string;
};

function normalizeRoomTypeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * When Cloudbeds has (or had) two physical rooms with the same display label,
 * the picker and check-in must resolve to the correct accommodation class.
 *
 * Room 100: only Interior Single King (the mistaken Interior Queen duplicate was renamed to 101).
 */
export const CANONICAL_ROOM_TYPE_BY_PICKER_LABEL: Record<string, string> = {
  '100': 'interior single king',
};

/** Normalised picker label from Cloudbeds `roomName` (strips parenthetical type hints). */
export function pickerLabelForRoom(room: { roomName: string }): string {
  const label = formatCloudbedsRoomNameLabel(room.roomName);
  if (label === '—' || label === '') return '';
  return label.trim().toLowerCase();
}

/** Pick one row when several Cloudbeds rooms share the same picker label. */
export function pickPreferredRoomForPickerLabel<T extends PickerRoomRow>(
  candidates: T[],
  pickerLabel: string
): T | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const canonical = CANONICAL_ROOM_TYPE_BY_PICKER_LABEL[pickerLabel];
  if (canonical) {
    const hit = candidates.find((r) => normalizeRoomTypeName(r.roomTypeName) === canonical);
    if (hit) return hit;
  }

  const typePriority = ['interior single king', 'interior queen'];
  for (const t of typePriority) {
    const hit = candidates.find((r) => normalizeRoomTypeName(r.roomTypeName) === t);
    if (hit) return hit;
  }

  return candidates[0];
}

/**
 * One entry per display label in the room picker. Prevents duplicate "100" rows when
 * Cloudbeds still returns both Interior Queen and Interior Single King under the same name.
 */
export function dedupePickerRoomsByDisplayLabel<T extends PickerRoomRow>(rooms: T[]): T[] {
  const byLabel = new Map<string, T[]>();
  const noLabel: T[] = [];

  for (const room of rooms) {
    const label = pickerLabelForRoom(room);
    if (!label) {
      noLabel.push(room);
      continue;
    }
    const list = byLabel.get(label) ?? [];
    list.push(room);
    byLabel.set(label, list);
  }

  const out: T[] = [];
  const seenIds = new Set<string>();

  for (const [label, group] of byLabel) {
    const winner =
      group.length === 1 ? group[0] : pickPreferredRoomForPickerLabel(group, label)!;
    if (!seenIds.has(winner.roomID)) {
      seenIds.add(winner.roomID);
      out.push(winner);
    }
  }

  for (const room of noLabel) {
    if (!seenIds.has(room.roomID)) {
      seenIds.add(room.roomID);
      out.push(room);
    }
  }

  return out;
}

/** Resolve ambiguous findRoomByKey matches to the canonical room for that label. */
export function resolveDuplicateRoomMatches<T extends PickerRoomRow>(
  matches: T[],
  roomKey: string
): T | undefined {
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];

  const fromName = pickerLabelForRoom({ roomName: roomKey });
  const label = fromName || pickerLabelForRoom(matches[0]) || roomKey.trim().toLowerCase();
  return pickPreferredRoomForPickerLabel(matches, label);
}
