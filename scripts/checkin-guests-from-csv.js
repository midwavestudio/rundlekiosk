/**
 * One-off script: read a visitors CSV export and check in each guest via the
 * cloudbeds-checkin API for a given date (e.g. 2026-02-26). Uses TYE rate.
 *
 * Usage (with dev server running on port 3000):
 *   node scripts/checkin-guests-from-csv.js "C:\Users\Gibs PC\Downloads\visitors-csv-export-83239-1772212486576.csv" 2026-02-26
 *
 * Or set API_BASE_URL to your deployed URL.
 */

const fs = require('fs');
const path = require('path');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

function parseCsvLine(line) {
  // Quoted CSV: "a","b","c" -> split on "," and strip surrounding quotes
  const raw = line.split('","').map((s) => s.replace(/^"|"$/g, '').replace(/""/g, '"'));
  if (raw.length > 0) {
    raw[0] = raw[0].replace(/^"/, '');
    raw[raw.length - 1] = raw[raw.length - 1].replace(/"$/, '').replace(/\r$/, '');
  }
  return raw;
}

function parseName(fullName) {
  const name = (fullName || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Guest', lastName: 'Guest' };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function nextDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function checkInGuest(row, checkInDate, checkOutDate) {
  const name = (row[1] || '').trim();
  const phone = (row[8] || '').replace(/^['"]|['"]$/g, '').trim();
  const clcNumber = (row[20] || '').trim();
  const classType = (row[21] || 'TYE').trim();
  const roomNumber = (row[22] || '').trim();

  const { firstName, lastName } = parseName(name);

  if (!roomNumber) {
    return { ok: false, name, error: 'Missing room number' };
  }

  const body = {
    firstName,
    lastName,
    phoneNumber: phone || undefined,
    roomName: roomNumber,
    clcNumber: clcNumber || undefined,
    classType: classType || 'TYE',
    checkInDate,
    checkOutDate,
  };

  const res = await fetch(`${API_BASE_URL}/api/cloudbeds-checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, name, room: roomNumber, status: res.status, error: data.error || data.message || res.statusText };
  }
  if (!data.success) {
    return { ok: false, name, room: roomNumber, error: data.error || data.message || 'Unknown' };
  }
  return { ok: true, name, room: roomNumber, reservationID: data.reservationID };
}

async function main() {
  const csvPath = process.argv[2] || path.join(__dirname, '..', 'visitors-csv-export-83239-1772212486576.csv');
  const checkInDate = process.argv[3] || '2026-02-26';
  const checkOutDate = nextDay(checkInDate);

  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const dataLines = lines.slice(1);

  console.log('Check-in date:', checkInDate, '→ Check-out:', checkOutDate);
  console.log('API base:', API_BASE_URL);
  console.log('Guests to process:', dataLines.length);
  console.log('');

  const results = { ok: [], fail: [] };
  for (let i = 0; i < dataLines.length; i++) {
    const row = parseCsvLine(dataLines[i]);
    const name = (row[1] || '').trim();
    const room = (row[22] || '').trim();
    process.stdout.write(`  [${i + 1}/${dataLines.length}] ${name} (Room ${room}) ... `);
    try {
      const result = await checkInGuest(row, checkInDate, checkOutDate);
      if (result.ok) {
        results.ok.push(result);
        console.log('OK');
      } else {
        results.fail.push(result);
        console.log('FAIL:', result.error || result.status);
      }
    } catch (err) {
      results.fail.push({ ok: false, name, room, error: err.message });
      console.log('ERROR:', err.message);
    }
  }

  console.log('');
  console.log('Done. Success:', results.ok.length, 'Failed:', results.fail.length);
  if (results.fail.length) {
    console.log('Failed guests:');
    results.fail.forEach((f) => console.log('  -', f.name, 'Room', f.room, ':', f.error));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
