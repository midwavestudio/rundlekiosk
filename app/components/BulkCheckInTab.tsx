'use client';

import { useState } from 'react';

interface BulkCheckInTabProps {
  // No props needed for now
}

interface CheckInResult {
  guest: string;
  room: string;
  status: 'success' | 'skipped' | 'error';
  message: string;
  reservationID?: string;
}

interface Summary {
  total: number;
  success: number;
  skipped: number;
  failed: number;
}

export default function BulkCheckInTab({}: BulkCheckInTabProps) {
  const [file, setFile] = useState<File | null>(null);
  const [checkInDate, setCheckInDate] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<CheckInResult[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.csv')) {
        setError('Please select a CSV file');
        setFile(null);
        return;
      }
      setFile(selectedFile);
      setError('');
      setResults(null);
      setSummary(null);
    }
  };

  const parseCsvLine = (line: string): string[] => {
    const raw = line.split('","').map((s) => s.replace(/^"|"$/g, '').replace(/""/g, '"'));
    if (raw.length > 0) {
      raw[0] = raw[0].replace(/^"/, '');
      raw[raw.length - 1] = raw[raw.length - 1].replace(/"$/, '').replace(/\r$/, '');
    }
    return raw;
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a CSV file');
      return;
    }

    setProcessing(true);
    setError('');
    setResults(null);
    setSummary(null);

    try {
      // Read and parse CSV
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(Boolean);
      
      if (lines.length < 2) {
        throw new Error('CSV file is empty or has no data rows');
      }

      const header = parseCsvLine(lines[0]);
      const nameIdx = header.findIndex(h => h.toLowerCase().includes('name'));
      const phoneIdx = header.findIndex(h => h.toLowerCase().includes('phone'));
      const roomIdx = header.findIndex(h => h.toLowerCase().includes('room'));
      const clcIdx = header.findIndex(h => h.toLowerCase().includes('clc'));
      const classIdx = header.findIndex(h => h.toLowerCase().includes('class'));
      const signInIdx = header.findIndex(h => h.toLowerCase().includes('sign_in') || h.toLowerCase().includes('sign in'));

      if (nameIdx === -1 || roomIdx === -1) {
        throw new Error('CSV must have "name" and "room number" columns');
      }

      const guests = lines.slice(1).map(line => {
        const row = parseCsvLine(line);
        return {
          name: (row[nameIdx] || '').trim(),
          phoneNumber: (row[phoneIdx] || '').replace(/^['"]|['"]$/g, '').trim(),
          roomNumber: (row[roomIdx] || '').trim(),
          clcNumber: (row[clcIdx] || '').trim(),
          classType: (row[classIdx] || 'TYE').trim(),
          signInTime: (row[signInIdx] || '').trim(),
        };
      }).filter(g => g.name && g.roomNumber);

      if (guests.length === 0) {
        throw new Error('No valid guest records found in CSV');
      }

      // Determine check-in date
      let selectedDate = checkInDate;
      if (!selectedDate && guests[0].signInTime) {
        // Extract date from first guest's sign-in time (YYYY-MM-DD)
        const match = guests[0].signInTime.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) selectedDate = match[1];
      }

      // Call bulk check-in API
      const response = await fetch('/api/bulk-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guests,
          checkInDate: selectedDate || undefined,
          skipDuplicates,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Bulk check-in failed');
      }

      setResults(data.results);
      setSummary(data.summary);

    } catch (err: any) {
      console.error('Bulk check-in error:', err);
      setError(err.message || 'Failed to process CSV');
    } finally {
      setProcessing(false);
    }
  };

  const getDateFromFile = () => {
    if (!file) return '';
    const match = file.name.match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
  };

  return (
    <div style={{ padding: '30px', overflow: 'auto', height: '100%' }}>
      <h2 style={{ marginTop: 0, color: '#333', fontSize: '24px' }}>Bulk Check-In from CSV</h2>
      <p style={{ color: '#666', marginBottom: '30px' }}>
        Upload a CSV file of guests to check them in to Cloudbeds. Duplicate names on the same day will be automatically skipped.
      </p>

      {/* Upload Form */}
      <div style={{
        background: '#f8f9fa',
        padding: '25px',
        borderRadius: '12px',
        marginBottom: '25px',
        border: '2px dashed #ddd'
      }}>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#333' }}>
            CSV File
          </label>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            disabled={processing}
            style={{
              padding: '10px',
              borderRadius: '8px',
              border: '1px solid #ddd',
              width: '100%',
              background: 'white'
            }}
          />
          {file && (
            <p style={{ marginTop: '8px', fontSize: '14px', color: '#666' }}>
              Selected: {file.name}
            </p>
          )}
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#333' }}>
            Check-In Date (optional)
          </label>
          <input
            type="date"
            value={checkInDate}
            onChange={(e) => setCheckInDate(e.target.value)}
            disabled={processing}
            placeholder={getDateFromFile() || 'Leave blank to use today or date from CSV'}
            style={{
              padding: '10px',
              borderRadius: '8px',
              border: '1px solid #ddd',
              width: '100%',
              background: 'white'
            }}
          />
          <p style={{ marginTop: '5px', fontSize: '13px', color: '#999' }}>
            Leave blank to use today's date or extract from CSV sign-in times
          </p>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={skipDuplicates}
              onChange={(e) => setSkipDuplicates(e.target.checked)}
              disabled={processing}
              style={{ marginRight: '10px', width: '18px', height: '18px' }}
            />
            <span style={{ fontSize: '14px', color: '#333' }}>
              Skip duplicate guests (same name + same date)
            </span>
          </label>
        </div>

        <button
          onClick={handleUpload}
          disabled={!file || processing}
          style={{
            background: file && !processing ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#ccc',
            color: 'white',
            padding: '12px 30px',
            borderRadius: '8px',
            border: 'none',
            fontSize: '16px',
            fontWeight: '600',
            cursor: file && !processing ? 'pointer' : 'not-allowed',
            width: '100%'
          }}
        >
          {processing ? 'Processing...' : 'Upload & Check In Guests'}
        </button>
      </div>

      {error && (
        <div style={{
          background: '#fee',
          color: '#c33',
          padding: '15px',
          borderRadius: '8px',
          marginBottom: '20px',
          border: '1px solid #fcc'
        }}>
          {error}
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div style={{
          background: '#f8f9fa',
          padding: '20px',
          borderRadius: '12px',
          marginBottom: '20px'
        }}>
          <h3 style={{ marginTop: 0, color: '#333' }}>Summary</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px' }}>
            <div style={{ padding: '15px', background: 'white', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '28px', fontWeight: '700', color: '#333' }}>{summary.total}</div>
              <div style={{ fontSize: '14px', color: '#666', marginTop: '5px' }}>Total</div>
            </div>
            <div style={{ padding: '15px', background: 'white', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '28px', fontWeight: '700', color: '#28a745' }}>{summary.success}</div>
              <div style={{ fontSize: '14px', color: '#666', marginTop: '5px' }}>Success</div>
            </div>
            <div style={{ padding: '15px', background: 'white', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '28px', fontWeight: '700', color: '#ffc107' }}>{summary.skipped}</div>
              <div style={{ fontSize: '14px', color: '#666', marginTop: '5px' }}>Skipped</div>
            </div>
            <div style={{ padding: '15px', background: 'white', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '28px', fontWeight: '700', color: '#dc3545' }}>{summary.failed}</div>
              <div style={{ fontSize: '14px', color: '#666', marginTop: '5px' }}>Failed</div>
            </div>
          </div>
        </div>
      )}

      {/* Results Table */}
      {results && results.length > 0 && (
        <div style={{
          background: 'white',
          borderRadius: '12px',
          overflow: 'hidden',
          border: '1px solid #e0e0e0'
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '15px', textAlign: 'left', borderBottom: '2px solid #e0e0e0', fontWeight: '600' }}>Guest</th>
                <th style={{ padding: '15px', textAlign: 'left', borderBottom: '2px solid #e0e0e0', fontWeight: '600' }}>Room</th>
                <th style={{ padding: '15px', textAlign: 'left', borderBottom: '2px solid #e0e0e0', fontWeight: '600' }}>Status</th>
                <th style={{ padding: '15px', textAlign: 'left', borderBottom: '2px solid #e0e0e0', fontWeight: '600' }}>Message</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '12px 15px' }}>{result.guest}</td>
                  <td style={{ padding: '12px 15px' }}>{result.room}</td>
                  <td style={{ padding: '12px 15px' }}>
                    <span style={{
                      padding: '4px 12px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: '600',
                      background: result.status === 'success' ? '#d4edda' : result.status === 'skipped' ? '#fff3cd' : '#f8d7da',
                      color: result.status === 'success' ? '#155724' : result.status === 'skipped' ? '#856404' : '#721c24'
                    }}>
                      {result.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '12px 15px', fontSize: '14px', color: '#666' }}>{result.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* CSV Format Info */}
      <div style={{
        marginTop: '30px',
        padding: '20px',
        background: '#f8f9fa',
        borderRadius: '12px',
        border: '1px solid #e0e0e0'
      }}>
        <h3 style={{ marginTop: 0, color: '#333', fontSize: '16px' }}>CSV Format Requirements</h3>
        <ul style={{ margin: 0, paddingLeft: '20px', color: '#666', fontSize: '14px', lineHeight: '1.8' }}>
          <li><strong>Required columns:</strong> name, room number (or "Room number")</li>
          <li><strong>Optional columns:</strong> phone_number, CLC number, Class, sign_in_time</li>
          <li><strong>Room matching:</strong> Rooms are matched by number only (e.g., "204" matches "204i", "Room 204", etc.)</li>
          <li><strong>Duplicate detection:</strong> Guests with the same name on the same check-in date will be skipped</li>
          <li><strong>Date auto-detect:</strong> If no date is specified, the system will try to extract it from the sign_in_time column</li>
        </ul>
      </div>
    </div>
  );
}
