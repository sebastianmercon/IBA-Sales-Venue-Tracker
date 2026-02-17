/**
 * Sync handler - coordinates two-way sync between Sheets and My Maps
 * 
 * Design Decision: Google Sheets is the SINGLE SOURCE OF TRUTH
 * Sync direction: Sheets -> My Maps (one-way from source of truth)
 * 
 * Polling Strategy: Frontend polls every 60 seconds
 * Backend reads Sheets, updates My Maps to match
 */

const { readVenues } = require('./sheets');
const { syncVenuesToMaps } = require('./maps');

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
    const venues = await readVenues(auth, sheetsId, sheetName);
    return {
      success: true,
      venues,
      count: venues.length,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error getting sync status:', error.message);
    throw error;
  }
}

module.exports = {
  syncSheetsToMaps,
  getSyncStatus,
};
