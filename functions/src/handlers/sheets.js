/**
 * Google Sheets API integration
 * 
 * Design Decision: Google Sheets is the SINGLE SOURCE OF TRUTH
 * All venue data and visit status originates from and is stored in Sheets
 * 
 * Column structure (0-indexed):
 * A (0): Venue Name
 * B (1): Full Address
 * C (2): Visited (TRUE/FALSE)
 */

const { google } = require('googleapis');
const { getColumnMappings, getConfig } = require('../utils/config');

const rowIndexCache = new Map();

function getColumnLetter(index) {
  if (index < 0) {
    return null;
  }
  let num = index + 1;
  let letters = '';
  while (num > 0) {
    const rem = (num - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    num = Math.floor((num - 1) / 26);
  }
  return letters;
}

function getMaxColumnIndex(mappings) {
  const values = Object.values(mappings).filter((value) => Number.isFinite(value) && value >= 0);
  return values.length > 0 ? Math.max(...values) : 2;
}

function getCellValue(row, index) {
  if (index < 0) {
    return '';
  }
  return row[index] || '';
}

function buildFullAddress(row, mappings) {
  const street = getCellValue(row, mappings.ADDRESS);
  const city = getCellValue(row, mappings.CITY);
  const state = getCellValue(row, mappings.STATE);
  const zip = getCellValue(row, mappings.ZIP);
  const parts = [street, city, state, zip].filter(Boolean);
  return parts.join(', ').replace(/\s+,/g, ',');
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getCacheKey(sheetsId, sheetName) {
  return `${sheetsId}:${sheetName}`;
}

function setRowIndexCache(sheetsId, sheetName, mappings, rows) {
  const cacheKey = getCacheKey(sheetsId, sheetName);
  const map = new Map();
  rows.forEach((row, idx) => {
    const name = normalizeKey(getCellValue(row, mappings.VENUE_NAME));
    if (!name) {
      return;
    }
    map.set(name, idx + 2);
  });
  rowIndexCache.set(cacheKey, map);
}

async function ensureRowIndexCache(sheets, sheetsId, sheetName, mappings) {
  const cacheKey = getCacheKey(sheetsId, sheetName);
  if (rowIndexCache.has(cacheKey)) {
    return rowIndexCache.get(cacheKey);
  }
  const maxColumnIndex = getMaxColumnIndex(mappings);
  const lastColumn = getColumnLetter(maxColumnIndex) || 'C';
  const range = `${sheetName}!A2:${lastColumn}`;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetsId,
    range,
  });
  const rows = response.data.values || [];
  setRowIndexCache(sheetsId, sheetName, mappings, rows);
  return rowIndexCache.get(cacheKey);
}

async function readVisitTimes(auth, sheetsId, visitTimesSheetName, mappings) {
  if (!visitTimesSheetName) {
    return new Map();
  }
  const sheets = google.sheets({ version: 'v4', auth });
  try {
    const resolvedSheetName = await safeSheetName(sheets, sheetsId, visitTimesSheetName);
    const maxColumnIndex = Math.max(
      mappings.VISIT_TIMES_NAME,
      mappings.VISIT_TIMES_BEST_TIME,
      mappings.VISIT_TIMES_BEST_DAYS
    );
    const lastColumn = getColumnLetter(maxColumnIndex) || 'C';
    const range = `${resolvedSheetName}!A2:${lastColumn}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetsId,
      range,
    });
    const rows = response.data.values || [];
    const visitTimesByName = new Map();
    rows.forEach((row) => {
      const name = getCellValue(row, mappings.VISIT_TIMES_NAME);
      if (!name) {
        return;
      }
      visitTimesByName.set(normalizeKey(name), {
        bestTimeToVisit: getCellValue(row, mappings.VISIT_TIMES_BEST_TIME),
        bestDaysToVisit: getCellValue(row, mappings.VISIT_TIMES_BEST_DAYS),
      });
    });
    return visitTimesByName;
  } catch (error) {
    return new Map();
  }
}

async function resolveSheetName(sheets, sheetsId, sheetName) {
  if (sheetName) {
    return sheetName;
  }

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetsId });
  const firstSheet = spreadsheet.data.sheets?.[0]?.properties?.title;
  if (!firstSheet) {
    throw new Error('No sheets found in spreadsheet');
  }
  return firstSheet;
}

async function safeSheetName(sheets, sheetsId, sheetName) {
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetsId });
    const sheetTitles = (spreadsheet.data.sheets || []).map(
      (s) => s.properties?.title
    );
    if (sheetTitles.includes(sheetName)) {
      return sheetName;
    }
    return sheetTitles[0] || sheetName;
  } catch (error) {
    return sheetName;
  }
}

/**
 * Read all venues from Google Sheets
 * Returns array of venue objects
 */
async function readVenues(auth, sheetsId, sheetName) {
  const sheets = google.sheets({ version: 'v4', auth });
  const COLUMN_MAPPINGS = getColumnMappings();
  const config = getConfig();
  
  try {
    const resolvedSheetName = await safeSheetName(sheets, sheetsId, sheetName);
    // Read all rows (skip header row)
    const maxColumnIndex = getMaxColumnIndex(COLUMN_MAPPINGS);
    const lastColumn = getColumnLetter(maxColumnIndex) || 'C';
    const range = `${resolvedSheetName}!A2:${lastColumn}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetsId,
      range,
    });

    const rows = response.data.values || [];
    const venues = [];
    setRowIndexCache(sheetsId, resolvedSheetName, COLUMN_MAPPINGS, rows);
    const visitTimesByName = await readVisitTimes(
      auth,
      sheetsId,
      config.visitTimesSheetName,
      COLUMN_MAPPINGS
    );

    for (const row of rows) {
      // Skip empty rows
      if (!row[COLUMN_MAPPINGS.VENUE_NAME]) {
        continue;
      }

      const name = getCellValue(row, COLUMN_MAPPINGS.VENUE_NAME).trim();
      const visitTimes = visitTimesByName.get(normalizeKey(name)) || {};
      const venue = {
        name,
        address: buildFullAddress(row, COLUMN_MAPPINGS) || getCellValue(row, COLUMN_MAPPINGS.ADDRESS),
        latitude: getCellValue(row, COLUMN_MAPPINGS.LATITUDE) || null,
        longitude: getCellValue(row, COLUMN_MAPPINGS.LONGITUDE) || null,
        priorityTag: getCellValue(row, COLUMN_MAPPINGS.PRIORITY_TAG),
        clusterId: getCellValue(row, COLUMN_MAPPINGS.CLUSTER_ID),
        premiseType: getCellValue(row, COLUMN_MAPPINGS.PREMISE_TYPE),
        assignedRep: getCellValue(row, COLUMN_MAPPINGS.ASSIGNED_REP),
        neighborhood: getCellValue(row, COLUMN_MAPPINGS.NEIGHBORHOOD),
        timeWindow1Start: getCellValue(row, COLUMN_MAPPINGS.TIME_WINDOW_1_START),
        timeWindow1End: getCellValue(row, COLUMN_MAPPINGS.TIME_WINDOW_1_END),
        timeWindow2Start: getCellValue(row, COLUMN_MAPPINGS.TIME_WINDOW_2_START),
        timeWindow2End: getCellValue(row, COLUMN_MAPPINGS.TIME_WINDOW_2_END),
        bestTimeToVisit: getCellValue(row, COLUMN_MAPPINGS.BEST_TIME) || visitTimes.bestTimeToVisit || '',
        bestDaysToVisit: getCellValue(row, COLUMN_MAPPINGS.BEST_DAYS) || visitTimes.bestDaysToVisit || '',
        contactName: getCellValue(row, COLUMN_MAPPINGS.CONTACT_NAME),
        contactTitle: getCellValue(row, COLUMN_MAPPINGS.CONTACT_TITLE),
        contactPhone: getCellValue(row, COLUMN_MAPPINGS.CONTACT_PHONE),
        contactEmail: getCellValue(row, COLUMN_MAPPINGS.CONTACT_EMAIL),
        notes: getCellValue(row, COLUMN_MAPPINGS.NOTES),
        visited: row[COLUMN_MAPPINGS.VISITED] === 'TRUE' || row[COLUMN_MAPPINGS.VISITED] === true,
      };

      venues.push(venue);
    }

    return venues;
  } catch (error) {
    if (error.message?.includes('invalid_request')) {
      const fallbackSheetName = await resolveSheetName(sheets, sheetsId, sheetName);
      const maxColumnIndex = getMaxColumnIndex(COLUMN_MAPPINGS);
      const lastColumn = getColumnLetter(maxColumnIndex) || 'C';
      const fallbackRange = `${fallbackSheetName}!A2:${lastColumn}`;
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetsId,
        range: fallbackRange,
      });
      const rows = response.data.values || [];
      const venues = [];
      setRowIndexCache(sheetsId, fallbackSheetName, COLUMN_MAPPINGS, rows);
      const visitTimesByName = await readVisitTimes(
        auth,
        sheetsId,
        config.visitTimesSheetName,
        COLUMN_MAPPINGS
      );
      for (const row of rows) {
        if (!row[COLUMN_MAPPINGS.VENUE_NAME]) {
          continue;
        }
        const name = getCellValue(row, COLUMN_MAPPINGS.VENUE_NAME).trim();
        const visitTimes = visitTimesByName.get(normalizeKey(name)) || {};
        const venue = {
          name,
          address: buildFullAddress(row, COLUMN_MAPPINGS) || getCellValue(row, COLUMN_MAPPINGS.ADDRESS),
          latitude: getCellValue(row, COLUMN_MAPPINGS.LATITUDE) || null,
          longitude: getCellValue(row, COLUMN_MAPPINGS.LONGITUDE) || null,
          clusterId: getCellValue(row, COLUMN_MAPPINGS.CLUSTER_ID),
          assignedRep: getCellValue(row, COLUMN_MAPPINGS.ASSIGNED_REP),
          neighborhood: getCellValue(row, COLUMN_MAPPINGS.NEIGHBORHOOD),
          timeWindow1Start: getCellValue(row, COLUMN_MAPPINGS.TIME_WINDOW_1_START),
          timeWindow1End: getCellValue(row, COLUMN_MAPPINGS.TIME_WINDOW_1_END),
          timeWindow2Start: getCellValue(row, COLUMN_MAPPINGS.TIME_WINDOW_2_START),
          timeWindow2End: getCellValue(row, COLUMN_MAPPINGS.TIME_WINDOW_2_END),
          bestTimeToVisit: getCellValue(row, COLUMN_MAPPINGS.BEST_TIME) || visitTimes.bestTimeToVisit || '',
          bestDaysToVisit: getCellValue(row, COLUMN_MAPPINGS.BEST_DAYS) || visitTimes.bestDaysToVisit || '',
          contactName: getCellValue(row, COLUMN_MAPPINGS.CONTACT_NAME),
          contactTitle: getCellValue(row, COLUMN_MAPPINGS.CONTACT_TITLE),
          contactPhone: getCellValue(row, COLUMN_MAPPINGS.CONTACT_PHONE),
          contactEmail: getCellValue(row, COLUMN_MAPPINGS.CONTACT_EMAIL),
          notes: getCellValue(row, COLUMN_MAPPINGS.NOTES),
          visited: row[COLUMN_MAPPINGS.VISITED] === 'TRUE' || row[COLUMN_MAPPINGS.VISITED] === true,
        };
        venues.push(venue);
      }
      return venues;
    }
    console.error('Error reading venues from Sheets:', error.message);
    throw new Error(`Failed to read venues from Google Sheets: ${error.message}`);
  }
}

/**
 * Update visited status for a specific venue
 * Finds venue by name and updates the Visited column
 */
async function updateVisitedStatus(auth, sheetsId, sheetName, venueName, visited) {
  const sheets = google.sheets({ version: 'v4', auth });
  const COLUMN_MAPPINGS = getColumnMappings();
  
  try {
    const resolvedSheetName = await safeSheetName(sheets, sheetsId, sheetName);
    const normalizedTarget = normalizeKey(venueName);
    const cache = await ensureRowIndexCache(
      sheets,
      sheetsId,
      resolvedSheetName,
      COLUMN_MAPPINGS
    );
    const rowIndex = cache.get(normalizedTarget);
    if (!rowIndex) {
      throw new Error(`Venue "${venueName}" not found in spreadsheet`);
    }

    const visitedColumn = getColumnLetter(COLUMN_MAPPINGS.VISITED) || 'C';
    // Update the Visited column
    const updateRange = `${resolvedSheetName}!${visitedColumn}${rowIndex}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetsId,
      range: updateRange,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[visited ? 'TRUE' : 'FALSE']],
      },
    });

    // Apply conditional formatting to make cell green (TRUE) or red (FALSE)
    await applyConditionalFormatting(auth, sheetsId, resolvedSheetName, rowIndex);

    return { success: true, rowIndex };
  } catch (error) {
    if (error.message?.includes('invalid_request')) {
      const fallbackSheetName = await resolveSheetName(sheets, sheetsId, sheetName);
      return updateVisitedStatus(auth, sheetsId, fallbackSheetName, venueName, visited);
    }
    console.error('Error updating visited status:', error.message);
    throw new Error(`Failed to update visited status: ${error.message}`);
  }
}

/**
 * Update latitude/longitude for a specific venue
 */
async function updateVenueCoordinates(auth, sheetsId, sheetName, venueName, latitude, longitude) {
  const sheets = google.sheets({ version: 'v4', auth });
  const COLUMN_MAPPINGS = getColumnMappings();

  if (COLUMN_MAPPINGS.LATITUDE < 0 && COLUMN_MAPPINGS.LONGITUDE < 0) {
    return { success: false, skipped: true };
  }

  try {
    const resolvedSheetName = await safeSheetName(sheets, sheetsId, sheetName);
    const normalizedTarget = normalizeKey(venueName);
    const cache = await ensureRowIndexCache(
      sheets,
      sheetsId,
      resolvedSheetName,
      COLUMN_MAPPINGS
    );
    const rowIndex = cache.get(normalizedTarget);
    if (!rowIndex) {
      throw new Error(`Venue "${venueName}" not found in spreadsheet`);
    }

    const updates = [];
    const latColumn = getColumnLetter(COLUMN_MAPPINGS.LATITUDE);
    const lngColumn = getColumnLetter(COLUMN_MAPPINGS.LONGITUDE);

    if (latColumn) {
      updates.push({
        range: `${resolvedSheetName}!${latColumn}${rowIndex}`,
        values: [[latitude]],
      });
    }
    if (lngColumn) {
      updates.push({
        range: `${resolvedSheetName}!${lngColumn}${rowIndex}`,
        values: [[longitude]],
      });
    }

    if (updates.length === 0) {
      return { success: false, skipped: true };
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetsId,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: updates,
      },
    });

    return { success: true, rowIndex };
  } catch (error) {
    if (error.message?.includes('invalid_request')) {
      const fallbackSheetName = await resolveSheetName(sheets, sheetsId, sheetName);
      return updateVenueCoordinates(auth, sheetsId, fallbackSheetName, venueName, latitude, longitude);
    }
    console.error('Error updating coordinates:', error.message);
    throw new Error(`Failed to update coordinates: ${error.message}`);
  }
}

/**
 * Apply conditional formatting to Visited column
 * Green for TRUE, red for FALSE
 */
async function applyConditionalFormatting(auth, sheetsId, sheetName, rowIndex) {
  const sheets = google.sheets({ version: 'v4', auth });
  const COLUMN_MAPPINGS = getColumnMappings();
  
  try {
    // Get sheet ID
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: sheetsId,
    });
    
    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) {
      console.warn('Sheet not found for conditional formatting');
      return;
    }

    const sheetId = sheet.properties.sheetId;

    const visitedColumnIndex = COLUMN_MAPPINGS.VISITED;
    if (!Number.isFinite(visitedColumnIndex) || visitedColumnIndex < 0) {
      return;
    }
    const visitedColumnLetter = getColumnLetter(visitedColumnIndex) || 'C';
    // Apply conditional formatting to the entire Visited column
    const requests = [
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [
              {
                sheetId,
                startRowIndex: 1, // Skip header
                endRowIndex: 10000, // Large number to cover all rows
                startColumnIndex: visitedColumnIndex,
                endColumnIndex: visitedColumnIndex + 1,
              },
            ],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [{ userEnteredValue: `=${visitedColumnLetter}2=TRUE` }],
              },
              format: {
                backgroundColor: { red: 0, green: 1, blue: 0, alpha: 0.3 },
              },
            },
          },
          index: 0,
        },
      },
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [
              {
                sheetId,
                startRowIndex: 1,
                endRowIndex: 10000,
                startColumnIndex: visitedColumnIndex,
                endColumnIndex: visitedColumnIndex + 1,
              },
            ],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [{ userEnteredValue: `=${visitedColumnLetter}2=FALSE` }],
              },
              format: {
                backgroundColor: { red: 1, green: 0, blue: 0, alpha: 0.3 },
              },
            },
          },
          index: 1,
        },
      },
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetsId,
      resource: { requests },
    });
  } catch (error) {
    // Conditional formatting is nice-to-have, don't fail if it errors
    console.warn('Error applying conditional formatting:', error.message);
  }
}

module.exports = {
  readVenues,
  updateVisitedStatus,
  updateVenueCoordinates,
};
