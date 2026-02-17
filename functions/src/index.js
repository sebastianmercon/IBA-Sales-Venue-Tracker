/**
 * Google Cloud Functions entry point
 * HTTP-triggered function for syncing Google Sheets and My Maps
 * 
 * Design Decision: Stateless backend, no database
 * All state comes from Google Sheets (source of truth)
 */

const path = require('path');
const zlib = require('zlib');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const functions = require('@google-cloud/functions-framework');
const cors = require('cors')({ origin: true });

const { getConfig } = require('./utils/config');
const { cache } = require('./utils/cache');
const { enrichProspectWithPlaces } = require('./utils/places');

/**
 * Send JSON response with gzip compression when the client supports it.
 * Falls back to plain JSON otherwise.
 */
function sendJson(req, res, statusCode, data) {
  const json = JSON.stringify(data);
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  if (acceptEncoding.includes('gzip')) {
    const buf = Buffer.from(json, 'utf-8');
    zlib.gzip(buf, (err, compressed) => {
      if (err) {
        // Fallback to uncompressed on error
        res.status(statusCode).json(data);
        return;
      }
      res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Content-Length': compressed.length,
      });
      res.end(compressed);
    });
    return;
  }
  res.status(statusCode).json(data);
}
const { getAuthenticatedClient } = require('./handlers/auth');
const {
  readVenues,
  updateVisitedStatus,
  updateVenueCoordinates,
  createProspect,
  updateProspect,
  deleteVenue,
  deleteProspect,
  cleanupProspectNotesTokens,
} = require('./handlers/sheets');
const { syncVenuesToMaps, updatePlacemarkColor, readMyMapsPolygons } = require('./handlers/maps');
const { syncSheetsToMaps, getSyncStatus } = require('./handlers/sync');

const VENUES_CACHE_TTL = 30_000;   // 30 seconds
const CLUSTERS_CACHE_TTL = 300_000; // 5 minutes (polygons rarely change)

/**
 * Main Cloud Function handler
 */
// Lazy auth: only authenticate when cache misses to avoid Secret Manager overhead.
let _authPromise = null;
let _authExpiresAt = 0;
const AUTH_TTL = 45 * 60_000; // refresh auth every 45 min

function getAuth(config) {
  const now = Date.now();
  if (_authPromise && now < _authExpiresAt) {
    return _authPromise;
  }
  _authExpiresAt = now + AUTH_TTL;
  _authPromise = getAuthenticatedClient(config.projectId, config.oauthSecretName);
  return _authPromise;
}

const syncHandler = async (req, res) => {
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

      // Route requests
      const { method, path } = req;

      // Health check (no auth needed)
      if (method === 'GET' && path === '/api/health') {
        return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
      }

      // Get all venues (used by polling) — serve from cache before auth
      if (method === 'GET' && path === '/api/venues') {
        const cached = cache.get('venues');
        if (cached) {
          return sendJson(req, res, 200, cached);
        }
        const auth = await getAuth(config);
        const status = await getSyncStatus(auth, config.sheetsId, config.sheetName);
        cache.set('venues', status, VENUES_CACHE_TTL);
        return sendJson(req, res, 200, status);
      }

      if (method === 'POST' && path === '/api/prospects/enrich') {
        const { venueName, latitude, longitude } = req.body || {};
        if (!venueName || !String(venueName).trim()) {
          return res.status(400).json({ error: 'venueName is required' });
        }
        if (!config.placesApiKey) {
          return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY is not configured' });
        }
        const result = await enrichProspectWithPlaces({
          apiKey: config.placesApiKey,
          venueName,
          latitude,
          longitude,
        });
        return res.status(200).json(result);
      }

      if (method === 'POST' && path === '/api/prospects') {
        if (!config.prospectSheetName) {
          return res.status(500).json({ error: 'PROSPECT_SHEET_NAME is not configured' });
        }
        const payload = req.body || {};
        if (!payload.name || !String(payload.name).trim()) {
          return res.status(400).json({ error: 'name is required' });
        }
        const auth = await getAuth(config);
        const result = await createProspect(auth, config.sheetsId, config.prospectSheetName, payload);
        cache.invalidate('venues');
        return res.status(201).json({ success: true, result });
      }

      if (method === 'POST' && path === '/api/prospects/cleanup-notes') {
        if (!config.prospectSheetName) {
          return res.status(500).json({ error: 'PROSPECT_SHEET_NAME is not configured' });
        }
        const auth = await getAuth(config);
        const result = await cleanupProspectNotesTokens(
          auth,
          config.sheetsId,
          config.prospectSheetName
        );
        cache.invalidate('venues');
        return res.status(200).json({ success: true, result });
      }

      if ((method === 'PATCH' || method === 'POST') && path.startsWith('/api/prospects/')) {
        if (!config.prospectSheetName) {
          return res.status(500).json({ error: 'PROSPECT_SHEET_NAME is not configured' });
        }
        const identifier = decodeURIComponent(path.replace('/api/prospects/', ''));
        const payload = req.body || {};
        const auth = await getAuth(config);
        const result = await updateProspect(
          auth,
          config.sheetsId,
          config.prospectSheetName,
          identifier,
          payload
        );
        cache.invalidate('venues');
        return res.status(200).json({ success: true, result });
      }

      if (method === 'DELETE' && path.startsWith('/api/prospects/')) {
        if (!config.prospectSheetName) {
          return res.status(500).json({ error: 'PROSPECT_SHEET_NAME is not configured' });
        }
        const identifier = decodeURIComponent(path.replace('/api/prospects/', ''));
        if (!identifier) {
          return res.status(400).json({ error: 'prospect identifier is required' });
        }
        const auth = await getAuth(config);
        const result = await deleteProspect(
          auth,
          config.sheetsId,
          config.prospectSheetName,
          identifier
        );
        cache.invalidate('venues');
        return res.status(200).json({ success: true, result });
      }

      // Update venue coordinates
      if (method === 'POST' && path.endsWith('/coordinates')) {
        const venueName = decodeURIComponent(path.replace('/api/venues/', '').replace('/coordinates', ''));
        const { latitude, longitude } = req.body;

        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
          return res.status(400).json({ error: 'latitude and longitude must be numbers' });
        }

        const auth = await getAuth(config);
        const result = await updateVenueCoordinates(
          auth,
          config.sheetsId,
          config.sheetName,
          venueName,
          latitude,
          longitude
        );

        cache.invalidate('venues');
        return res.status(200).json({ success: true, result });
      }

      // Update visited status for a venue
      if (method === 'POST' && path.endsWith('/visited')) {
        const venueName = decodeURIComponent(path.replace('/api/venues/', '').replace('/visited', ''));
        const { visited } = req.body;

        if (typeof visited !== 'boolean') {
          return res.status(400).json({ error: 'visited must be a boolean' });
        }

        const auth = await getAuth(config);

        // Update Sheets (source of truth)
        await updateVisitedStatus(auth, config.sheetsId, config.sheetName, venueName, visited);

        // Invalidate venues cache so the next poll gets fresh data
        cache.invalidate('venues');

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

      if (method === 'DELETE' && path.startsWith('/api/venues/')) {
        const venueName = decodeURIComponent(path.replace('/api/venues/', ''));
        if (!venueName) {
          return res.status(400).json({ error: 'venue name is required' });
        }
        const auth = await getAuth(config);
        const result = await deleteVenue(
          auth,
          config.sheetsId,
          config.sheetName,
          venueName
        );
        cache.invalidate('venues');
        return res.status(200).json({ success: true, result });
      }

      // Trigger manual sync
      if (method === 'GET' && path === '/api/sync') {
        const auth = await getAuth(config);
        const result = await syncSheetsToMaps(auth, config.sheetsId, config.sheetName, config.mapsId);
        return res.status(200).json(result);
      }

      // Get cluster polygons from My Maps — cached for 5 min
      if (method === 'GET' && path === '/api/clusters') {
        const cached = cache.get('clusters');
        if (cached) {
          return sendJson(req, res, 200, cached);
        }
        const auth = await getAuth(config);
        const polygons = await readMyMapsPolygons(auth, config.mapsId);
        const body = { success: true, polygons };
        cache.set('clusters', body, CLUSTERS_CACHE_TTL);
        return sendJson(req, res, 200, body);
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
};

functions.http('syncHandler', syncHandler);

module.exports = {
  syncHandler,
};
