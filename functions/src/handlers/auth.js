/**
 * Authentication handler for Google APIs
 * Manages OAuth tokens stored in Google Cloud Secret Manager
 * 
 * Design Decision: Admin configures once, tokens stored securely in Secret Manager
 * No per-user authentication - shared access model
 */

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { google } = require('googleapis');

const secretClient = new SecretManagerServiceClient();

/**
 * Get OAuth tokens from Secret Manager
 * Tokens are stored as JSON: { access_token, refresh_token, expiry_date }
 */
async function getStoredTokens(projectId, secretName) {
  try {
    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
    const [version] = await secretClient.accessSecretVersion({ name });
    const tokens = JSON.parse(version.payload.data.toString());
    return tokens;
  } catch (error) {
    console.error('Error retrieving tokens from Secret Manager:', error.message);
    throw new Error('Failed to retrieve OAuth tokens. Run setup-auth.js first.');
  }
}

/**
 * Store OAuth tokens in Secret Manager
 */
async function storeTokens(projectId, secretName, tokens) {
  try {
    const parent = `projects/${projectId}`;
    
    // Check if secret exists
    try {
      await secretClient.getSecret({ name: `${parent}/secrets/${secretName}` });
    } catch (error) {
      // Secret doesn't exist, create it
      await secretClient.createSecret({
        parent,
        secretId: secretName,
        secret: {
          replication: { automatic: {} },
        },
      });
    }

    // Add new version with tokens
    await secretClient.addSecretVersion({
      parent: `${parent}/secrets/${secretName}`,
      payload: {
        data: Buffer.from(JSON.stringify(tokens)),
      },
    });
  } catch (error) {
    console.error('Error storing tokens in Secret Manager:', error.message);
    throw error;
  }
}

/**
 * Get authenticated Google API client
 * Handles token refresh automatically
 */
async function getAuthenticatedClient(projectId, secretName) {
  const tokens = await getStoredTokens(projectId, secretName);

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET. Set them in functions/.env and restart.');
  }
  
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000'
  );

  oauth2Client.setCredentials(tokens);

  // Refresh token if expired
  if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      
      // Update stored tokens
      await storeTokens(projectId, secretName, credentials);
    } catch (error) {
      console.error('Error refreshing token:', error.message);
      throw new Error('Token refresh failed. Re-run setup-auth.js.');
    }
  }

  return oauth2Client;
}

module.exports = {
  getAuthenticatedClient,
  getStoredTokens,
  storeTokens,
};
