/**
 * Sync handler - coordinates two-way sync between Sheets and My Maps
 * 
 * Design Decision: Google Sheets is the SINGLE SOURCE OF TRUTH
 * Sync direction: Sheets -> My Maps (one-way from source of truth)
 * 
 * Polling Strategy: Frontend polls every 60 seconds
 * Backend reads Sheets, updates My Maps to match
 */

const { readVenues, readActiveVenuesOnly, syncVenuesAcrossSheets } = require('./sheets');
const { syncVenuesToMaps } = require('./maps');
const { cache } = require('../utils/cache');

const DUAL_SYNC_INTERVAL_MS = 5 * 60 * 1000;
let lastDualSyncAt = 0;
let dualSyncInFlight = null;

function normalizeVenueName(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmptyValue(value) {
  return value === undefined || value === null || value === '';
}

function hasCoordinates(venue) {
  return Number.isFinite(Number(venue?.latitude)) && Number.isFinite(Number(venue?.longitude));
}

function choosePrimaryVenue(existingVenue, candidateVenue) {
  const existingIsActive = existingVenue?.recordType === 'active';
  const candidateIsActive = candidateVenue?.recordType === 'active';
  if (candidateIsActive && !existingIsActive) {
    return candidateVenue;
  }
  if (existingIsActive && !candidateIsActive) {
    return existingVenue;
  }
  if (!hasCoordinates(existingVenue) && hasCoordinates(candidateVenue)) {
    return candidateVenue;
  }
  return existingVenue;
}

function mergeVenueRecords(primaryVenue, secondaryVenue) {
  const merged = { ...primaryVenue };
  Object.entries(secondaryVenue || {}).forEach(([key, value]) => {
    if (isEmptyValue(merged[key]) && !isEmptyValue(value)) {
      merged[key] = value;
    }
  });
  return merged;
}

function dedupeVenuesForClient(venues) {
  const dedupedByName = new Map();
  (Array.isArray(venues) ? venues : []).forEach((venue) => {
    const key = normalizeVenueName(venue?.name);
    if (!key) return;
    const existing = dedupedByName.get(key);
    if (!existing) {
      dedupedByName.set(key, venue);
      return;
    }
    const primary = choosePrimaryVenue(existing, venue);
    const secondary = primary === existing ? venue : existing;
    dedupedByName.set(key, mergeVenueRecords(primary, secondary));
  });
  return Array.from(dedupedByName.values());
}

async function runDualSyncNow(auth, sheetsId, sheetName, prospectSheetName, options = {}) {
  if (!prospectSheetName) {
    return { success: true, skipped: true, reason: 'PROSPECT_SHEET_NAME is not configured' };
  }
  const result = await syncVenuesAcrossSheets(auth, sheetsId, sheetName, prospectSheetName, options);
  lastDualSyncAt = Date.now();
  cache.invalidate('venues');
  return result;
}

async function runDualSyncIfDue(auth, sheetsId, sheetName, prospectSheetName, options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  if (!force && now - lastDualSyncAt < DUAL_SYNC_INTERVAL_MS) {
    return { success: true, skipped: true, dueInMs: DUAL_SYNC_INTERVAL_MS - (now - lastDualSyncAt) };
  }
  if (dualSyncInFlight) {
    return dualSyncInFlight;
  }
  dualSyncInFlight = runDualSyncNow(auth, sheetsId, sheetName, prospectSheetName, options)
    .finally(() => {
      dualSyncInFlight = null;
    });
  return dualSyncInFlight;
}

/**
 * Full sync from Sheets to My Maps
 * Reads all venues from Sheets and updates My Maps placemarks
 * 
 * This is the primary sync operation called during polling
 */
async function syncSheetsToMaps(auth, sheetsId, sheetName, mapsFileId) {
  try {
    // Read venues from Sheets (source of truth)
    const venues = await readVenues(auth, sheetsId, sheetName);
    const activeVenues = venues.filter((venue) => venue.recordType !== 'prospect');
    
    if (activeVenues.length === 0) {
      console.warn('No venues found in Sheets');
      return { success: true, synced: 0, message: 'No venues to sync' };
    }

    // Sync to My Maps
    // Note: My Maps updates may be delayed - eventual consistency is expected
    const result = await syncVenuesToMaps(auth, mapsFileId, activeVenues);

    return {
      success: true,
      synced: activeVenues.length,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error syncing Sheets to My Maps:', error.message);
    throw error;
  }
}

/**
 * Get current sync status
 * Returns venues from Sheets (source of truth)
 */
async function getSyncStatus(auth, sheetsId, sheetName) {
  try {
    const allVenues = await readVenues(auth, sheetsId, sheetName);
    const venues = dedupeVenuesForClient(allVenues);
    return {
      success: true,
      venues,
      count: venues.length,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.warn('Full venue read failed, attempting active-only fallback:', error.message);
    try {
      const activeVenues = await readActiveVenuesOnly(auth, sheetsId, sheetName);
      return {
        success: true,
        venues: activeVenues,
        count: activeVenues.length,
        degraded: true,
        reason: 'Serving active venues only due to read pressure on secondary sheet',
        timestamp: new Date().toISOString(),
      };
    } catch (fallbackError) {
      console.error('Error getting sync status:', fallbackError.message);
      throw fallbackError;
    }
  }
}

module.exports = {
  syncSheetsToMaps,
  getSyncStatus,
  runDualSyncIfDue,
  runDualSyncNow,
};
