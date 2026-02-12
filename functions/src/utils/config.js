/**
 * Configuration loader for Google Cloud Functions
 * Reads from environment variables and Secret Manager
 */

/**
 * Get configuration from environment variables
 * Note: In Cloud Functions, env vars are set during deployment
 */
function getConfig() {
  return {
    sheetsId: process.env.GOOGLE_SHEETS_ID,
    mapsId: process.env.GOOGLE_MAPS_ID,
    pollingInterval: parseInt(process.env.POLLING_INTERVAL || '60', 10),
    sheetName: process.env.SHEET_NAME || 'Sheet1',
    visitTimesSheetName: process.env.VISIT_TIMES_SHEET_NAME || 'Visit Times',
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
    oauthSecretName: process.env.OAUTH_SECRET_NAME || 'sheets-maps-oauth-tokens',
  };
}

function parseColumnIndex(envKey, fallback) {
  const raw = process.env[envKey];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Column mappings for Google Sheets
 * Default order (main sheet):
 * A=Order ID, B=Name, C=Visited, D=Street Address, E=City, F=State, G=Zip,
 * H=Neighborhood, I=Time Window 1 Start, J=Time Window 1 End,
 * K=Time Window 2 Start, L=Time Window 2 End, M=Contact Name,
 * N=Contact Title, O=Contact Phone, P=Contact Email, Q=Notes.
 *
 * Visit Times sheet (optional): A=Name, B=Best Time, C=Best Days.
 *
 * Override with env vars (0-indexed): COLUMN_VENUE_NAME_INDEX, COLUMN_ADDRESS_INDEX,
 * COLUMN_VISITED_INDEX, COLUMN_BEST_TIME_INDEX, COLUMN_BEST_DAYS_INDEX,
 * COLUMN_CONTACT_NAME_INDEX, COLUMN_CONTACT_TITLE_INDEX, COLUMN_LATITUDE_INDEX,
 * COLUMN_LONGITUDE_INDEX, COLUMN_CLUSTER_ID_INDEX, COLUMN_ASSIGNED_REP_INDEX,
 * COLUMN_CITY_INDEX, COLUMN_STATE_INDEX, COLUMN_ZIP_INDEX, COLUMN_NEIGHBORHOOD_INDEX,
 * COLUMN_TIME_WINDOW_1_START_INDEX, COLUMN_TIME_WINDOW_1_END_INDEX,
 * COLUMN_TIME_WINDOW_2_START_INDEX, COLUMN_TIME_WINDOW_2_END_INDEX,
 * COLUMN_CONTACT_PHONE_INDEX, COLUMN_CONTACT_EMAIL_INDEX, COLUMN_NOTES_INDEX,
 * COLUMN_PRIORITY_TAG_INDEX, COLUMN_PREMISE_TYPE_INDEX,
 * VISIT_TIMES_NAME_INDEX, VISIT_TIMES_BEST_TIME_INDEX, VISIT_TIMES_BEST_DAYS_INDEX.
 */
function getColumnMappings() {
  return {
    VENUE_NAME: parseColumnIndex('COLUMN_VENUE_NAME_INDEX', 1), // Column B
    ADDRESS: parseColumnIndex('COLUMN_ADDRESS_INDEX', 3), // Column D
    VISITED: parseColumnIndex('COLUMN_VISITED_INDEX', 2), // Column C
    CITY: parseColumnIndex('COLUMN_CITY_INDEX', 4), // Column E
    STATE: parseColumnIndex('COLUMN_STATE_INDEX', 5), // Column F
    ZIP: parseColumnIndex('COLUMN_ZIP_INDEX', 6), // Column G
    NEIGHBORHOOD: parseColumnIndex('COLUMN_NEIGHBORHOOD_INDEX', 7), // Column H
    TIME_WINDOW_1_START: parseColumnIndex('COLUMN_TIME_WINDOW_1_START_INDEX', 8), // Column I
    TIME_WINDOW_1_END: parseColumnIndex('COLUMN_TIME_WINDOW_1_END_INDEX', 9), // Column J
    TIME_WINDOW_2_START: parseColumnIndex('COLUMN_TIME_WINDOW_2_START_INDEX', 10), // Column K
    TIME_WINDOW_2_END: parseColumnIndex('COLUMN_TIME_WINDOW_2_END_INDEX', 11), // Column L
    CONTACT_NAME: parseColumnIndex('COLUMN_CONTACT_NAME_INDEX', 12), // Column M
    CONTACT_TITLE: parseColumnIndex('COLUMN_CONTACT_TITLE_INDEX', 13), // Column N
    CONTACT_PHONE: parseColumnIndex('COLUMN_CONTACT_PHONE_INDEX', 14), // Column O
    CONTACT_EMAIL: parseColumnIndex('COLUMN_CONTACT_EMAIL_INDEX', 15), // Column P
    NOTES: parseColumnIndex('COLUMN_NOTES_INDEX', 16), // Column Q
    BEST_TIME: parseColumnIndex('COLUMN_BEST_TIME_INDEX', -1),
    BEST_DAYS: parseColumnIndex('COLUMN_BEST_DAYS_INDEX', -1),
    LATITUDE: parseColumnIndex('COLUMN_LATITUDE_INDEX', -1),
    LONGITUDE: parseColumnIndex('COLUMN_LONGITUDE_INDEX', -1),
    PRIORITY_TAG: parseColumnIndex('COLUMN_PRIORITY_TAG_INDEX', 17), // Column R
    CLUSTER_ID: parseColumnIndex('COLUMN_CLUSTER_ID_INDEX', 18), // Column S
    PREMISE_TYPE: parseColumnIndex('COLUMN_PREMISE_TYPE_INDEX', 19), // Column T
    ASSIGNED_REP: parseColumnIndex('COLUMN_ASSIGNED_REP_INDEX', -1),
    VISIT_TIMES_NAME: parseColumnIndex('VISIT_TIMES_NAME_INDEX', 0),
    VISIT_TIMES_BEST_TIME: parseColumnIndex('VISIT_TIMES_BEST_TIME_INDEX', 1),
    VISIT_TIMES_BEST_DAYS: parseColumnIndex('VISIT_TIMES_BEST_DAYS_INDEX', 2),
  };
}

/**
 * My Maps color codes
 */
const MAP_COLORS = {
  VISITED: '#00FF00',      // Green
  NOT_VISITED: '#FF0000',  // Red
};

module.exports = {
  getConfig,
  getColumnMappings,
  MAP_COLORS,
};
