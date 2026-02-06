# Setup Instructions

Complete setup guide for the Sheets-Maps Sync Dashboard.

## Prerequisites

- Google Cloud account with billing enabled
- Google Cloud SDK (`gcloud`) installed
- Node.js 18+ installed
- Access to Google Sheets document
- Access to Google My Maps file

## Step 1: Google Cloud Project Setup

1. **Create a Google Cloud Project**:
   ```bash
   gcloud projects create your-project-id
   gcloud config set project your-project-id
   ```

2. **Enable Required APIs**:
   ```bash
   gcloud services enable sheets.googleapis.com
   gcloud services enable drive.googleapis.com
   gcloud services enable secretmanager.googleapis.com
   ```

3. **Create OAuth 2.0 Credentials**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Navigate to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Application type: "Web application"
   - Authorized redirect URIs: `http://localhost:3000`
   - Save the Client ID and Client Secret

## Step 2: Google Sheets Setup

1. **Create or Open Your Google Sheet**:
   - Create a new Google Sheet or use an existing one
   - Ensure the sheet has the following columns (in order):
     - Column A: Venue Name
     - Column B: Full Address
     - Column C: Latitude (optional)
     - Column D: Longitude (optional)
     - Column E: Cluster ID
     - Column F: Assigned Rep (optional)
     - Column G: Visited (TRUE/FALSE)

2. **Get Sheet ID**:
   - From the URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`
   - Copy the `SHEET_ID` part

3. **Share Sheet**:
   - Share the sheet with the service account email (if using service account)
   - Or ensure the OAuth account has access

## Step 3: Google My Maps Setup

1. **Create or Open Your My Maps File**:
   - Go to [Google My Maps](https://www.google.com/maps/d/)
   - Create a new map or use an existing one
   - Add placemarks for your venues (or they will be created automatically)

2. **Get Maps ID**:
   - From the URL: `https://www.google.com/maps/d/viewer?mid={MAPS_ID}`
   - Copy the `MAPS_ID` part

3. **Share Maps File**:
   - Click "Share" on your My Maps file
   - Share with the service account email (if using service account)
   - Or ensure the OAuth account has access
   - Note: The file must be accessible to the account used for OAuth

## Step 4: Configure Authentication

1. **Set Environment Variables** (for setup script):
   ```bash
   export GOOGLE_CLIENT_ID="your-client-id"
   export GOOGLE_CLIENT_SECRET="your-client-secret"
   export GOOGLE_CLOUD_PROJECT="your-project-id"
   ```

2. **Run Setup Script**:
   ```bash
   cd scripts
   npm install  # Install dependencies if needed
   node setup-auth.js
   ```

3. **Follow the Prompts**:
   - Visit the authorization URL
   - Grant permissions
   - Copy the authorization code
   - Paste it into the script
   - Tokens will be stored in Secret Manager

## Step 5: Deploy Backend

1. **Install Dependencies**:
   ```bash
   cd functions
   npm install
   ```

2. **Deploy Cloud Function**:
   ```bash
   # Option 1: Use deployment script
   cd ../scripts
   chmod +x deploy.sh
   ./deploy.sh

   # Option 2: Manual deployment
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

3. **Get Function URL**:
   ```bash
   gcloud functions describe syncHandler --gen2 --region us-central1 --format="value(serviceConfig.uri)"
   ```

## Step 6: Deploy Frontend

1. **Install Dependencies**:
   ```bash
   cd frontend
   npm install
   ```

2. **Configure Environment**:
   Create `.env` file:
   ```bash
   VITE_API_BASE_URL=https://your-function-url
   VITE_MAPS_URL=https://www.google.com/maps/d/viewer?mid=your_maps_id
   ```

3. **Build**:
   ```bash
   npm run build
   ```

4. **Deploy** (choose one):
   - **Firebase Hosting**:
     ```bash
     npm install -g firebase-tools
     firebase init hosting
     firebase deploy --only hosting
     ```
   
   - **Netlify**:
     ```bash
     npm install -g netlify-cli
     netlify deploy --prod
     ```
   
   - **Vercel**:
     ```bash
     npm install -g vercel
     vercel --prod
     ```

## Step 7: Configure CORS

If deploying frontend to a different domain, update Cloud Function CORS settings:

1. Edit `functions/src/index.js`
2. Update CORS origin in the `cors` configuration
3. Redeploy the function

## Verification

1. **Test Backend**:
   ```bash
   curl https://your-function-url/api/health
   ```

2. **Test Frontend**:
   - Open the deployed frontend URL
   - Check that the map loads
   - Verify venues appear
   - Test status toggle

## Troubleshooting

### Authentication Errors
- Verify OAuth tokens are stored in Secret Manager
- Check that OAuth scopes are correct
- Re-run `setup-auth.js` if tokens expired

### Sheets Access Errors
- Verify sheet is shared with OAuth account
- Check sheet ID is correct
- Verify column structure matches expected format

### My Maps Access Errors
- Verify My Maps file is shared with OAuth account
- Check maps ID is correct
- Note: My Maps updates may be delayed (eventual consistency)

### CORS Errors
- Update CORS origin in Cloud Function
- Verify frontend URL matches CORS configuration

## Next Steps

- Monitor Cloud Function logs: `gcloud functions logs read syncHandler --gen2`
- Adjust polling interval if needed
- Customize frontend styling as needed
