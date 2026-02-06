# Deployment Guide

Step-by-step deployment instructions for production.

## Prerequisites

- Google Cloud account with billing enabled
- `gcloud` CLI installed and authenticated
- Node.js 18+ installed
- Completed setup (see `SETUP.md`)

## Backend Deployment (Google Cloud Functions)

### Option 1: Using Deployment Script

```bash
cd scripts
chmod +x deploy.sh
./deploy.sh
```

Follow the prompts to enter:
- Google Cloud Project ID
- Google Sheets ID
- Google My Maps ID
- Polling interval (default: 60 seconds)

### Option 2: Manual Deployment

```bash
cd functions

# Install dependencies
npm install

# Deploy function
gcloud functions deploy syncHandler \
  --gen2 \
  --runtime nodejs18 \
  --region us-central1 \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point syncHandler \
  --source . \
  --set-env-vars GOOGLE_SHEETS_ID=your_sheet_id,GOOGLE_MAPS_ID=your_maps_id,POLLING_INTERVAL=60,GOOGLE_CLOUD_PROJECT=your-project-id \
  --memory 512MB \
  --timeout 540s
```

### Get Function URL

After deployment, get the function URL:

```bash
gcloud functions describe syncHandler \
  --gen2 \
  --region us-central1 \
  --format="value(serviceConfig.uri)"
```

Save this URL for frontend configuration.

## Frontend Deployment

### Build Frontend

```bash
cd frontend

# Install dependencies
npm install

# Create .env file
cat > .env << EOF
VITE_API_BASE_URL=https://your-function-url
VITE_MAPS_URL=https://www.google.com/maps/d/viewer?mid=your_maps_id
EOF

# Build
npm run build
```

The `dist/` directory contains the built application.

### Deploy to Firebase Hosting

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Initialize (if not already done)
firebase init hosting

# Deploy
firebase deploy --only hosting
```

### Deploy to Netlify

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login
netlify login

# Deploy
netlify deploy --prod --dir=dist
```

### Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

### Deploy to Any Static Host

Upload the contents of `frontend/dist/` to your static hosting provider:
- AWS S3 + CloudFront
- Google Cloud Storage
- Azure Static Web Apps
- Any other static hosting service

## Environment Variables

### Backend (Cloud Functions)

Set via `--set-env-vars` during deployment:
- `GOOGLE_SHEETS_ID`: Google Sheets document ID
- `GOOGLE_MAPS_ID`: Google My Maps file ID
- `POLLING_INTERVAL`: Sync interval in seconds (default: 60)
- `SHEET_NAME`: Sheet tab name (default: "Sheet1")
- `GOOGLE_CLOUD_PROJECT`: Google Cloud Project ID
- `OAUTH_SECRET_NAME`: Secret name in Secret Manager (default: "sheets-maps-oauth-tokens")

### Frontend

Set via `.env` file or build-time environment variables:
- `VITE_API_BASE_URL`: Cloud Functions URL
- `VITE_MAPS_URL`: Google My Maps URL

## CORS Configuration

If frontend is on a different domain, update CORS in `functions/src/index.js`:

```javascript
const cors = require('cors')({ 
  origin: 'https://your-frontend-domain.com' 
});
```

Then redeploy the function.

## Monitoring

### View Logs

```bash
# Cloud Functions logs
gcloud functions logs read syncHandler --gen2 --region us-central1 --limit 50

# Real-time logs
gcloud functions logs tail syncHandler --gen2 --region us-central1
```

### Check Function Status

```bash
gcloud functions describe syncHandler --gen2 --region us-central1
```

### Monitor API Usage

- Google Cloud Console > APIs & Services > Dashboard
- Check quotas for Sheets API and Drive API

## Updating Deployment

### Update Backend

```bash
cd functions
# Make changes to code
npm install  # if dependencies changed
gcloud functions deploy syncHandler --gen2 --region us-central1 --source .
```

### Update Frontend

```bash
cd frontend
# Make changes to code
npm run build
# Redeploy to hosting service
```

## Rollback

### Rollback Cloud Function

```bash
# List revisions
gcloud functions revisions list syncHandler --gen2 --region us-central1

# Rollback to previous revision
gcloud functions deploy syncHandler --gen2 --region us-central1 --source . --revision=previous-revision-id
```

### Rollback Frontend

Depends on hosting provider:
- **Firebase**: `firebase hosting:rollback`
- **Netlify**: Use Netlify dashboard to rollback
- **Vercel**: Use Vercel dashboard to rollback

## Cost Optimization

- Cloud Functions: Pay per invocation and execution time
- Consider setting up budget alerts in Google Cloud Console
- Monitor API quota usage
- Adjust polling interval if needed (longer = fewer API calls)

## Security Checklist

- [ ] OAuth tokens stored in Secret Manager
- [ ] CORS configured for frontend domain only
- [ ] Function deployed with appropriate IAM roles
- [ ] Sheets and Maps files shared with correct accounts
- [ ] No API keys exposed in frontend code
- [ ] Environment variables set securely

## Troubleshooting

### Function Not Deploying

- Check `gcloud` authentication: `gcloud auth list`
- Verify project: `gcloud config get-value project`
- Check quotas: Google Cloud Console > IAM & Admin > Quotas

### Function Errors

- Check logs: `gcloud functions logs read syncHandler --gen2`
- Verify environment variables are set correctly
- Check OAuth tokens in Secret Manager

### Frontend Not Loading

- Verify `VITE_API_BASE_URL` is correct
- Check browser console for errors
- Verify CORS is configured correctly
- Check network tab for API calls

## Production Checklist

- [ ] Backend deployed and tested
- [ ] Frontend deployed and tested
- [ ] CORS configured correctly
- [ ] Environment variables set
- [ ] OAuth tokens configured
- [ ] Monitoring set up
- [ ] Error handling tested
- [ ] Documentation updated
