# Bulk Check-In Feature

## Overview
The admin dashboard now includes a **Bulk Check-In** tab that allows staff to upload a CSV file of guests and check them all in to Cloudbeds at once.

## Key Features

### 1. **CSV Upload Interface**
- Navigate to Admin Dashboard → Bulk Check-In tab
- Upload a CSV file exported from your visitor management system
- Optionally specify a check-in date (defaults to today or auto-detects from CSV)
- Toggle duplicate detection on/off

### 2. **Duplicate Detection**
- **Enabled by default** to prevent duplicate check-ins
- Checks for guests with the same name on the same check-in date
- Fetches existing reservations from Cloudbeds before processing
- Skips duplicates automatically with clear status in results

### 3. **Flexible Room Matching**
- Matches rooms by number only (ignores letters/suffixes)
- Examples:
  - CSV "204" matches Cloudbeds "204i", "Room 204", "204", etc.
  - CSV "302" matches Cloudbeds "302i", "302", etc.
- Case-insensitive and flexible matching

### 4. **Real-Time Progress**
- Shows summary: Total, Success, Skipped, Failed
- Detailed results table with status for each guest
- Color-coded status badges (green=success, yellow=skipped, red=error)

## CSV Format

### Required Columns
- `name` - Guest full name (e.g., "John Smith")
- `Room number` or `room_number` - Room number (e.g., "204", "302")

### Optional Columns
- `phone_number` - Guest phone
- `CLC number` - CLC billing number
- `Class` - Rate class (defaults to "TYE")
- `sign_in_time` - Used for auto-detecting check-in date

### Example CSV
```csv
"name","phone_number","Room number","CLC number","Class","sign_in_time"
"Scott Linton","+14062911407","302","744847","TYE","2026-02-27 11:00:46"
"Paul Semmen","+14024321893","219","578757","TYE","2026-02-27 09:51:06"
```

## API Endpoints

### POST /api/bulk-checkin
Processes multiple guest check-ins from CSV data.

**Request Body:**
```json
{
  "guests": [
    {
      "name": "John Smith",
      "phoneNumber": "+14061234567",
      "roomNumber": "302",
      "clcNumber": "123456",
      "classType": "TYE",
      "signInTime": "2026-02-27 11:00:00"
    }
  ],
  "checkInDate": "2026-02-27",  // Optional, defaults to today
  "skipDuplicates": true        // Optional, defaults to true
}
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "total": 10,
    "success": 8,
    "skipped": 1,
    "failed": 1
  },
  "results": [
    {
      "guest": "John Smith",
      "room": "302",
      "status": "success",
      "message": "Checked in successfully",
      "reservationID": "12345"
    }
  ],
  "checkInDate": "2026-02-27",
  "checkOutDate": "2026-02-28"
}
```

## How It Works

1. **Upload CSV** - Staff uploads CSV from visitor management system
2. **Parse Data** - System extracts guest names, room numbers, contact info
3. **Check Duplicates** - Fetches existing Cloudbeds reservations for the date
4. **Process Guests** - For each guest:
   - Skip if duplicate (same name + same date)
   - Find room by number (flexible matching with letters)
   - Create reservation with TYE rate
   - Assign room
   - Set status to checked in
5. **Show Results** - Display summary and detailed status for each guest

## Usage Notes

- **Rate Limiting**: Processes guests sequentially with 500ms delay to avoid API rate limits
- **Past Dates**: Cloudbeds may reject reservations for past dates - use current/future dates for testing
- **Room Availability**: System checks for available rooms and rates; will fail if room/rate unavailable
- **Duplicate Logic**: Compares `firstName + lastName` (normalized, case-insensitive) with existing reservations on the same check-in date

## Troubleshooting

### "Room XXX not found"
- Room may not exist in Cloudbeds
- Check that getRooms returns the room
- Verify room naming in Cloudbeds (may have letter suffixes)

### "Reservation creation failed: We're sorry..."
- Date may be in the past (Cloudbeds restriction)
- No available inventory for that room type + date
- Try a current or future date

### Duplicates Not Being Detected
- Ensure `skipDuplicates` is enabled
- Check that Cloudbeds API credentials are configured
- Verify guest names match exactly (case-insensitive comparison)

## Files Modified/Created

### New Files
- `app/api/bulk-checkin/route.ts` - Bulk check-in API endpoint
- `app/components/BulkCheckInTab.tsx` - CSV upload UI component

### Modified Files
- `app/components/Dashboard.tsx` - Added Bulk Check-In tab
- `app/api/cloudbeds-checkin/route.ts` - Enhanced room matching for letter suffixes

## Testing

1. Start dev server: `npm run dev`
2. Navigate to `/admin` and sign in
3. Click "Bulk Check-In" tab
4. Upload `test-bulk-checkin.csv` (or your CSV export)
5. Select check-in date (or leave blank for today)
6. Click "Upload & Check In Guests"
7. Review results table

## Future Enhancements

- Export results to CSV
- Email notifications for failed check-ins
- Batch size configuration
- Retry failed check-ins
- Preview before processing
