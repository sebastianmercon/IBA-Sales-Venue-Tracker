# Quick Start Guide

Get up and running in 5 minutes.

## Prerequisites

- Google Cloud account
- Node.js 18+
- `gcloud` CLI installed

## 1. Clone and Install

```bash
# Install backend dependencies
cd functions
npm install

# Install frontend dependencies
cd ../frontend
npm install

# Install script dependencies
cd ../scripts
npm install
```

## 2. Google Cloud Setup

```bash
# Set your project
gcloud config set project YOUR_PROJECT_ID

# Enable APIs
gcloud services enable sheets.googleapis.com
gcloud services enable drive.googleapis.com
gcloud services enable secretmanager.googleapis.com
```

## 3. Configure OAuth

```bash
cd scripts

# Set environment variables
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export GOOGLE_CLOUD_PROJECT="your-project-id"

# Run setup
node setup-auth.js
```

Follow the prompts to authorize and store tokens.

## 4. Deploy Backend

```bash
cd ../scripts
chmod +x deploy.sh
./deploy.sh
```

Enter your Sheets ID and Maps ID when prompted.

## 5. Configure Frontend

```bash
cd ../frontend

# Create .env file
cat > .env << EOF
VITE_API_BASE_URL=https://your-function-url
VITE_MAPS_URL=https://www.google.com/maps/d/viewer?mid=your_maps_id
EOF

# Build
npm run build
```

## 6. Deploy Frontend

Deploy the `frontend/dist/` directory to your hosting service:

- **Firebase**: `firebase deploy --only hosting`
- **Netlify**: `netlify deploy --prod --dir=dist`
- **Vercel**: `vercel --prod`

## Done!

Open your frontend URL and start tracking venues.

## Need Help?

- See `docs/SETUP.md` for detailed setup
- See `docs/API.md` for API documentation
- See `docs/DEPLOYMENT.md` for deployment details

