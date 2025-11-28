# Rundle Kiosk - Dual Check-In System

A complete dual check-in system for Rundle Suites Hotel that simultaneously processes check-ins and check-outs across Cloudbeds PMS and CLC (BNSF Crew Lodging) platforms.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Firebase account
- (Optional) Cloudbeds API credentials
- (Optional) CLC API credentials

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/rundlekiosk.git
cd rundlekiosk

# Install dependencies
npm install

# Copy environment template
cp env.example .env

# Edit .env with your Firebase credentials
```

### Run Locally

```bash
# Start the development server
npm run dev

# Server will run on http://localhost:3000
```

### Web App

Simply open `web/index.html` in your browser - no build process needed!

## 📁 Project Structure

```
rundlekiosk/
├── api/              # API endpoints
├── lib/              # Core libraries (Cloudbeds, CLC, Firebase)
├── web/              # Web application
├── ios/              # iOS app (future)
├── server.js         # Express server
└── .env              # Environment variables (not in git)
```

## 🔧 Configuration

1. **Firebase Setup**: See `FIREBASE_SETUP.md`
2. **Local Development**: See `LOCAL_DEVELOPMENT.md`
3. **GitHub Setup**: See `GITHUB_SETUP.md`
4. **Complete Guide**: See `GET_STARTED.md`

## 📚 Documentation

- `GET_STARTED.md` - Quick start guide
- `SETUP_GUIDE.md` - Detailed setup instructions
- `ARCHITECTURE.md` - System architecture
- `FIREBASE_SETUP.md` - Firebase configuration
- `WEB_APP_SETUP.md` - Web app details
- `LOCAL_DEVELOPMENT.md` - Development guide

## 🎯 Features

- ✅ Dual check-in/check-out (Cloudbeds + CLC)
- ✅ Room assignment
- ✅ Guest management
- ✅ Transaction logging
- ✅ Automatic retry for failures
- ✅ Offline mode support
- ✅ Beautiful web interface
- ✅ Firebase authentication

## 🔒 Security

- Environment variables stored in `.env` (not committed)
- Firebase authentication
- HTTPS/SSL for production
- Secure credential management

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📞 Support

For issues or questions, please open an issue on GitHub.

---

**Built for Rundle Suites Hotel** 🏨
