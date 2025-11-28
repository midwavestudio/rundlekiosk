# Starting the Local Server

## Quick Start

1. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

2. **Create .env file** (if not already done):
   ```bash
   # Copy the example
   cp env.example .env
   
   # Then edit .env with your credentials
   # For testing, you can use placeholder values
   ```

3. **Start the server**:
   ```bash
   npm run start:local
   ```
   
   Or:
   ```bash
   node server.js
   ```

4. **Test the server**:
   Open your browser to: http://localhost:3000/api/health
   
   Or use curl:
   ```bash
   curl http://localhost:3000/api/health
   ```

## Expected Output

When the server starts successfully, you should see:

```
╔══════════════════════════════════════════════════════════╗
║     Rundle Kiosk API - Local Development Server        ║
╠══════════════════════════════════════════════════════════╣
║  Server running on: http://localhost:3000               ║
║  Health check: http://localhost:3000/api/health          ║
║  Environment: development                               ║
╚══════════════════════════════════════════════════════════╝
```

## Available Endpoints

Once running, all endpoints are available at `http://localhost:3000/api/`:

- `GET /api/health` - Health check (no auth required)
- `POST /api/checkin` - Dual check-in (requires auth)
- `POST /api/checkout` - Dual check-out (requires auth)
- `GET /api/arrivals` - Today's arrivals (requires auth)
- `GET /api/departures` - Today's departures (requires auth)
- `GET /api/reservations` - Search reservations (requires auth)
- `GET /api/rooms` - Available rooms (requires auth)
- `POST /api/room-assign` - Assign room (requires auth)
- `POST /api/retry-failed` - Retry failed operations (requires auth)

## Testing Without Credentials

You can start the server without real credentials. It will:
- ✅ Start successfully
- ✅ Respond to health check
- ⚠️  Fail on API calls that require Cloudbeds/CLC/Firebase

This is useful for:
- Testing the server structure
- Developing the iOS app UI
- Learning the API structure

## Next Steps

1. ✅ Server is running
2. Configure iOS app to use `http://localhost:3000/api`
3. Test endpoints with Postman or curl
4. Add real credentials when ready

## Troubleshooting

**Port 3000 already in use?**
- Change `PORT=3001` in `.env`
- Or kill the process: `netstat -ano | findstr :3000`

**Firebase errors?**
- Check `.env` has correct Firebase credentials
- Verify private key includes `\n` for newlines

**Module not found?**
- Run `npm install` again
- Check `node_modules` exists

---

**Server is ready!** 🚀



