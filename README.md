# Real-Time Google Sheets ↔ Google My Maps Sync Dashboard

A production-ready MVP for syncing venue visit status between Google Sheets and Google My Maps in real-time.

## Architecture

- **Frontend**: React SPA with embedded Google My Maps
- **Backend**: Google Cloud Functions (serverless)
- **Sync**: Polling-based (60-second intervals)
- **Source of Truth**: Google Sheets only
- **No Database**: Stateless backend, direct Sheets ↔ Maps sync

## Quick Start

1. **Setup Google Cloud Project**:
   ```bash
   # Enable required APIs
   gcloud services enable sheets.googleapis.com
   gcloud services enable drive.googleapis.com
   gcloud services enable secretmanager.googleapis.com
   ```

2. **Configure Authentication**:
   ```bash
   cd scripts
   node setup-auth.js
   ```

3. **Deploy Backend**:
   ```bash
   cd functions
   gcloud functions deploy syncHandler \
     --runtime nodejs18 \
     --trigger http \
     --allow-unauthenticated \
     --set-env-vars GOOGLE_SHEETS_ID=your_sheet_id,GOOGLE_MAPS_ID=your_maps_id,POLLING_INTERVAL=60
   ```

4. **Deploy Frontend**:
   ```bash
   cd frontend
   npm install
   npm run build
   # Deploy dist/ to Firebase Hosting, Netlify, or similar
   ```

See `docs/SETUP.md` for detailed instructions.

## Key Constraints

- **Single Source of Truth**: Google Sheets only
- **No Database**: Stateless backend
- **Polling**: 60-second intervals
- **Shared Access**: Admin configures once
- **Existing My Maps**: Uses provided file, doesn't create new ones
- **Eventual Consistency**: Tolerates My Maps update delays

## Project Structure

```
/
├── frontend/          # React application
├── functions/         # Google Cloud Functions
├── scripts/           # Setup and deployment scripts
└── docs/             # Documentation
```
