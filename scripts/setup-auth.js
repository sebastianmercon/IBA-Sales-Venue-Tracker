/**
 * Admin OAuth Setup Script
 * 
 * Run this once to configure OAuth authentication
 * Stores tokens in Google Cloud Secret Manager for shared access
 * 
 * Usage: node setup-auth.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'functions', '.env') });
const { google } = require('googleapis');
const readline = require('readline');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// OAuth 2.0 scopes required
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets', // Google Sheets
  'https://www.googleapis.com/auth/drive',        // Google Drive (for My Maps)
];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setupAuth() {
  console.log('=== Google OAuth Setup ===\n');
  console.log('This script will help you authorize access to Google Sheets and My Maps.');
  console.log('You need to have OAuth 2.0 credentials set up in Google Cloud Console.\n');

  // Get configuration
  const clientId = process.env.GOOGLE_CLIENT_ID || await question('Enter Google Client ID: ');
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || await question('Enter Google Client Secret: ');
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000';
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || await question('Enter Google Cloud Project ID: ');
  const secretName = process.env.OAUTH_SECRET_NAME || 'sheets-maps-oauth-tokens';

  if (!clientId || !clientSecret || !projectId) {
    console.error('Error: Missing required configuration');
    process.exit(1);
  }

  // Create OAuth client
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to get refresh token
  });

  console.log('\n=== Authorization Required ===');
  console.log('Please visit this URL to authorize:');
  console.log(authUrl);
  console.log('\nAfter authorization, you will be redirected.');
  console.log('Copy the authorization code from the URL (code=...)\n');

  const code = await question('Enter the authorization code: ');

  // Exchange code for tokens
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n✓ Authorization successful!');

    // Store tokens in Secret Manager
    const secretClient = new SecretManagerServiceClient();
    const parent = `projects/${projectId}`;

    // Check if secret exists
    try {
      await secretClient.getSecret({ name: `${parent}/secrets/${secretName}` });
      console.log(`✓ Secret "${secretName}" already exists`);
    } catch (error) {
      // Secret doesn't exist, create it
      await secretClient.createSecret({
        parent,
        secretId: secretName,
        secret: {
          replication: { automatic: {} },
        },
      });
      console.log(`✓ Created secret "${secretName}"`);
    }

    // Add new version with tokens
    await secretClient.addSecretVersion({
      parent: `${parent}/secrets/${secretName}`,
      payload: {
        data: Buffer.from(JSON.stringify(tokens)),
      },
    });

    console.log(`✓ Tokens stored in Secret Manager`);
    console.log('\n=== Setup Complete ===');
    console.log('Your OAuth tokens are now stored securely.');
    console.log('The application will use these tokens for API access.\n');
  } catch (error) {
    console.error('Error during authorization:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run setup
setupAuth().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
