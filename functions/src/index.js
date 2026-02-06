/**
 * Google Cloud Functions entry point
 * HTTP-triggered function for syncing Google Sheets and My Maps
 * 
 * Design Decision: Stateless backend, no database
 * All state comes from Google Sheets (source of truth)
 */

const functions = require('@google-cloud/functions-framework');
const cors = require('cors')({ origin: true });

const { getConfig } = require('./utils/config');
const { getAuthenticatedClient } = require('./handlers/auth');
const { readVenues, updateVisitedStatus, updateVenueCoordinates } = require('./handlers/sheets');
const { syncVenuesToMaps, updatePlacemarkColor } = require('./handlers/maps');
const { syncSheetsToMaps, getSyncStatus } = require('./handlers/sync');

/**
 * Main Cloud Function handler
 */
functions.http('syncHandler', async (req, res) => {
  // Handle CORS preflight
  return cors(req, res, async () => {
    try {
      const config = getConfig();

      // Validate configuration
      if (!config.sheetsId || !config.mapsId || !config.projectId) {
        return res.status(500).json({
          error: 'Missing required configuration. Set GOOGLE_SHEETS_ID, GOOGLE_MAPS_ID, and GOOGLE_CLOUD_PROJECT environment variables.',
        });
      }

      // Get authenticated client
      const auth = await getAuthenticatedClient(config.projectId, config.oauthSecretName);

      // Route requests
      const { method, path } = req;

      // Health check
      if (method === 'GET' && path === '/api/health') {
        return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
      }

      // Get all venues (used by polling)
      if (method === 'GET' && path === '/api/venues') {
        const status = await getSyncStatus(auth, config.sheetsId, config.sheetName);
        return res.status(200).json(status);
      }

      // Update venue coordinates
      if (method === 'POST' && path.endsWith('/coordinates')) {
        const venueName = decodeURIComponent(path.replace('/api/venues/', '').replace('/coordinates', ''));
        const { latitude, longitude } = req.body;

        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
          return res.status(400).json({ error: 'latitude and longitude must be numbers' });
        }

        const result = await updateVenueCoordinates(
          auth,
          config.sheetsId,
          config.sheetName,
          venueName,
          latitude,
          longitude
        );

        return res.status(200).json({ success: true, result });
      }

      // Update visited status for a venue
      if (method === 'POST' && path.endsWith('/visited')) {
        const venueName = decodeURIComponent(path.replace('/api/venues/', '').replace('/visited', ''));
        const { visited } = req.body;

        if (typeof visited !== 'boolean') {
          return res.status(400).json({ error: 'visited must be a boolean' });
        }

        // Update Sheets (source of truth)
        await updateVisitedStatus(auth, config.sheetsId, config.sheetName, venueName, visited);

        // Return immediately — don't wait for My Maps or re-read
        res.status(200).json({
          success: true,
          venue: { name: venueName, visited },
        });

        // Fire-and-forget: update My Maps in background
        updatePlacemarkColor(auth, config.mapsId, venueName, visited).catch((mapsError) => {
          console.warn('My Maps update failed (background):', mapsError.message);
        });
        return;
      }

      // Trigger manual sync
      if (method === 'GET' && path === '/api/sync') {
        const result = await syncSheetsToMaps(auth, config.sheetsId, config.sheetName, config.mapsId);
        return res.status(200).json(result);
      }

      // 404 for unknown routes
      return res.status(404).json({ error: 'Not found' });
    } catch (error) {
      console.error('Error in syncHandler:', error);
      return res.status(500).json({
        error: error.message || 'Internal server error',
      });
    }
  });
});
