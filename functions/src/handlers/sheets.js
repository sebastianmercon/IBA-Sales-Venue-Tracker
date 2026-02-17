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
const { getColumnMappings, getProspectColumnMappings, getConfig } = require('../utils/config');

const rowIndexCache = new Map();
const COORDS_TOKEN_REGEX = /\[\[coords:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]\]/i;

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

function toFiniteNumber(value) {
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

function parseCoordsFromNotes(notes) {
  const text = String(notes || '');
  const match = text.match(COORDS_TOKEN_REGEX);
  if (!match) {
    return null;
  }
  const latitude = toFiniteNumber(match[1]);
  const longitude = toFiniteNumber(match[2]);
  if (latitude === null || longitude === null) {
    return null;
  }
  return { latitude, longitude };
}

function stripCoordsToken(notes) {
  return String(notes || '').replace(COORDS_TOKEN_REGEX, '').trim();
}

function stripVisitedToken(notes) {
  return String(notes || '').replace(/\[\[visited:\s*(true|false)\s*\]\]/ig, '').trim();
}

function stripSystemTokens(notes) {
  const withoutCoords = stripCoordsToken(notes);
  const withoutVisited = stripVisitedToken(withoutCoords);
  return withoutVisited.trim();
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

function buildVenueFromRow(row, mappings, visitTimesByName, recordType, sourceSheetName) {
  const name = getCellValue(row, mappings.VENUE_NAME).trim();
  const visitTimes = visitTimesByName.get(normalizeKey(name)) || {};
  const address = buildFullAddress(row, mappings) || getCellValue(row, mappings.ADDRESS);
  const sourceKey = `${sourceSheetName || ''}:${name}`;
  const id = normalizeKey(sourceKey);

  const rawNotes = getCellValue(row, mappings.NOTES);
  const coordsFromNotes = parseCoordsFromNotes(rawNotes);
  const latFromColumn = toFiniteNumber(getCellValue(row, mappings.LATITUDE));
  const lngFromColumn = toFiniteNumber(getCellValue(row, mappings.LONGITUDE));
  const hasVisitedColumn = Number.isFinite(mappings.VISITED) && mappings.VISITED >= 0;
  const visitedFromColumn = hasVisitedColumn
    ? row[mappings.VISITED] === 'TRUE' || row[mappings.VISITED] === true
    : null;

  return {
    id,
    recordType,
    sourceSheet: sourceSheetName,
    name,
    address,
    latitude: latFromColumn ?? coordsFromNotes?.latitude ?? null,
    longitude: lngFromColumn ?? coordsFromNotes?.longitude ?? null,
    priorityTag: getCellValue(row, mappings.PRIORITY_TAG),
    clusterId: getCellValue(row, mappings.CLUSTER_ID),
    premiseType: getCellValue(row, mappings.PREMISE_TYPE),
    assignedRep: getCellValue(row, mappings.ASSIGNED_REP),
    neighborhood: getCellValue(row, mappings.NEIGHBORHOOD),
    timeWindow1Start: getCellValue(row, mappings.TIME_WINDOW_1_START),
    timeWindow1End: getCellValue(row, mappings.TIME_WINDOW_1_END),
    timeWindow2Start: getCellValue(row, mappings.TIME_WINDOW_2_START),
    timeWindow2End: getCellValue(row, mappings.TIME_WINDOW_2_END),
    bestTimeToVisit: getCellValue(row, mappings.BEST_TIME) || visitTimes.bestTimeToVisit || '',
    bestDaysToVisit: getCellValue(row, mappings.BEST_DAYS) || visitTimes.bestDaysToVisit || '',
    contactName: getCellValue(row, mappings.CONTACT_NAME),
    contactTitle: getCellValue(row, mappings.CONTACT_TITLE),
    contactPhone: getCellValue(row, mappings.CONTACT_PHONE),
    contactEmail: getCellValue(row, mappings.CONTACT_EMAIL),
    notes: stripSystemTokens(rawNotes),
    visited: typeof visitedFromColumn === 'boolean'
      ? visitedFromColumn
      : false,
  };
}

async function readSheetVenues(sheets, auth, sheetsId, preferredSheetName, mappings, visitTimesByName, recordType) {
  const resolvedSheetName = await safeSheetName(sheets, sheetsId, preferredSheetName);
  const maxColumnIndex = getMaxColumnIndex(mappings);
  const lastColumn = getColumnLetter(maxColumnIndex) || 'C';
  const range = `${resolvedSheetName}!A2:${lastColumn}`;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetsId,
    range,
  });
  const rows = response.data.values || [];
  setRowIndexCache(sheetsId, resolvedSheetName, mappings, rows);

  const venues = [];
  for (const row of rows) {
    if (!row[mappings.VENUE_NAME]) {
      continue;
    }
    venues.push(buildVenueFromRow(row, mappings, visitTimesByName, recordType, resolvedSheetName));
  }

  return venues;
}

/**
 * Read all venues from Google Sheets
 * Returns array of venue objects
 */
async function readVenues(auth, sheetsId, sheetName) {
  const sheets = google.sheets({ version: 'v4', auth });
  const COLUMN_MAPPINGS = getColumnMappings();
  const PROSPECT_COLUMN_MAPPINGS = getProspectColumnMappings();
  const config = getConfig();
  
  try {
    const visitTimesByName = await readVisitTimes(
      auth,
      sheetsId,
      config.visitTimesSheetName,
      COLUMN_MAPPINGS
    );
    const activeVenues = await readSheetVenues(
      sheets,
      auth,
      sheetsId,
      sheetName,
      COLUMN_MAPPINGS,
      visitTimesByName,
      'active'
    );
    let prospectVenues = [];
    if (config.prospectSheetName) {
      prospectVenues = await readSheetVenues(
        sheets,
        auth,
        sheetsId,
        config.prospectSheetName,
        PROSPECT_COLUMN_MAPPINGS,
        new Map(),
        'prospect'
      );
    }
    return [...activeVenues, ...prospectVenues];
  } catch (error) {
    if (error.message?.includes('invalid_request')) {
      const fallbackSheetName = await resolveSheetName(sheets, sheetsId, sheetName);
      return readVenues(auth, sheetsId, fallbackSheetName);
    }
    console.error('Error reading venues from Sheets:', error.message);
    throw new Error(`Failed to read venues from Google Sheets: ${error.message}`);
  }
}

async function getRowIndexByName(sheets, sheetsId, sheetName, venueName, mappings) {
  const normalizedTarget = normalizeKey(venueName);
  const cache = await ensureRowIndexCache(
    sheets,
    sheetsId,
    sheetName,
    mappings
  );
  return cache.get(normalizedTarget) || null;
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

async function createProspect(auth, sheetsId, prospectSheetName, payload) {
  const sheets = google.sheets({ version: 'v4', auth });
  const mappings = getProspectColumnMappings();
  const resolvedSheetName = await safeSheetName(sheets, sheetsId, prospectSheetName);

  const row = [];
  row[mappings.VENUE_NAME] = String(payload.name || '').trim();
  row[mappings.ADDRESS] = String(payload.address || '').trim();
  row[mappings.VISITED] = payload.visited ? 'TRUE' : 'FALSE';
  row[mappings.PREMISE_TYPE] = String(payload.premiseType || '').trim();
  row[mappings.CONTACT_NAME] = String(payload.contactName || '').trim();
  row[mappings.CONTACT_TITLE] = String(payload.contactTitle || '').trim();
  row[mappings.CONTACT_PHONE] = String(payload.contactPhone || '').trim();
  row[mappings.CONTACT_EMAIL] = String(payload.contactEmail || '').trim();
  row[mappings.NOTES] = stripSystemTokens(payload.notes);
  row[mappings.ASSIGNED_REP] = String(payload.assignedRep || '').trim();

  if (mappings.LATITUDE >= 0 && payload.latitude !== undefined && payload.latitude !== null) {
    row[mappings.LATITUDE] = payload.latitude;
  }
  if (mappings.LONGITUDE >= 0 && payload.longitude !== undefined && payload.longitude !== null) {
    row[mappings.LONGITUDE] = payload.longitude;
  }

  const maxColumnIndex = getMaxColumnIndex(mappings);
  const normalizedRow = new Array(maxColumnIndex + 1).fill('');
  row.forEach((value, index) => {
    if (index >= 0) {
      normalizedRow[index] = value ?? '';
    }
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetsId,
    range: `${resolvedSheetName}!A:A`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      values: [normalizedRow],
    },
  });

  rowIndexCache.delete(getCacheKey(sheetsId, resolvedSheetName));
  return { success: true, sheetName: resolvedSheetName };
}

async function updateProspect(auth, sheetsId, prospectSheetName, identifier, payload) {
  const sheets = google.sheets({ version: 'v4', auth });
  const mappings = getProspectColumnMappings();
  const resolvedSheetName = await safeSheetName(sheets, sheetsId, prospectSheetName);
  const targetName = String(identifier || payload.name || '').trim();
  if (!targetName) {
    throw new Error('Prospect name is required for updates');
  }

  const rowIndex = await getRowIndexByName(
    sheets,
    sheetsId,
    resolvedSheetName,
    targetName,
    mappings
  );
  if (!rowIndex) {
    throw new Error(`Prospect "${targetName}" not found`);
  }

  const updates = [];
  const setField = (columnIndex, key) => {
    if (!Number.isFinite(columnIndex) || columnIndex < 0 || !(key in payload)) {
      return;
    }
    const col = getColumnLetter(columnIndex);
    if (!col) return;
    updates.push({
      range: `${resolvedSheetName}!${col}${rowIndex}`,
      values: [[payload[key] ?? '']],
    });
  };

  setField(mappings.VENUE_NAME, 'name');
  setField(mappings.ADDRESS, 'address');
  if ('visited' in payload && Number.isFinite(mappings.VISITED) && mappings.VISITED >= 0) {
    const visitedCol = getColumnLetter(mappings.VISITED);
    if (visitedCol) {
      updates.push({
        range: `${resolvedSheetName}!${visitedCol}${rowIndex}`,
        values: [[payload.visited ? 'TRUE' : 'FALSE']],
      });
    }
  }
  setField(mappings.PREMISE_TYPE, 'premiseType');
  setField(mappings.CONTACT_NAME, 'contactName');
  setField(mappings.CONTACT_TITLE, 'contactTitle');
  setField(mappings.CONTACT_PHONE, 'contactPhone');
  setField(mappings.CONTACT_EMAIL, 'contactEmail');
  if ('notes' in payload) {
    let baseNotes = '';
    if ('notes' in payload) {
      baseNotes = String(payload.notes || '');
    } else if (Number.isFinite(mappings.NOTES) && mappings.NOTES >= 0) {
      const notesCol = getColumnLetter(mappings.NOTES);
      if (notesCol) {
        const notesResp = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetsId,
          range: `${resolvedSheetName}!${notesCol}${rowIndex}`,
        });
        baseNotes = notesResp?.data?.values?.[0]?.[0] || '';
      }
    }
    const notesWithCoords = stripSystemTokens(baseNotes);
    const notesCol = getColumnLetter(mappings.NOTES);
    if (notesCol) {
      updates.push({
        range: `${resolvedSheetName}!${notesCol}${rowIndex}`,
        values: [[notesWithCoords]],
      });
    }
  }
  setField(mappings.ASSIGNED_REP, 'assignedRep');
  setField(mappings.LATITUDE, 'latitude');
  setField(mappings.LONGITUDE, 'longitude');

  if (updates.length === 0) {
    return { success: true, rowIndex, updated: 0 };
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetsId,
    resource: {
      valueInputOption: 'USER_ENTERED',
      data: updates,
    },
  });
  rowIndexCache.delete(getCacheKey(sheetsId, resolvedSheetName));
  return { success: true, rowIndex, updated: updates.length };
}

async function deleteRowByVenueName(auth, sheetsId, preferredSheetName, venueName, mappings) {
  const sheets = google.sheets({ version: 'v4', auth });
  const resolvedSheetName = await safeSheetName(sheets, sheetsId, preferredSheetName);
  const rowIndex = await getRowIndexByName(
    sheets,
    sheetsId,
    resolvedSheetName,
    venueName,
    mappings
  );
  if (!rowIndex) {
    throw new Error(`Venue "${venueName}" not found`);
  }

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: sheetsId,
  });
  const targetSheet = (spreadsheet.data.sheets || []).find(
    (sheet) => sheet.properties?.title === resolvedSheetName
  );
  if (!targetSheet?.properties?.sheetId) {
    throw new Error(`Sheet "${resolvedSheetName}" not found`);
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetsId,
    resource: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: targetSheet.properties.sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex - 1,
              endIndex: rowIndex,
            },
          },
        },
      ],
    },
  });

  rowIndexCache.delete(getCacheKey(sheetsId, resolvedSheetName));
  return { success: true, rowIndex, sheetName: resolvedSheetName };
}

async function deleteVenue(auth, sheetsId, sheetName, venueName) {
  const mappings = getColumnMappings();
  return deleteRowByVenueName(auth, sheetsId, sheetName, venueName, mappings);
}

async function deleteProspect(auth, sheetsId, prospectSheetName, venueName) {
  const mappings = getProspectColumnMappings();
  return deleteRowByVenueName(auth, sheetsId, prospectSheetName, venueName, mappings);
}

async function cleanupProspectNotesTokens(auth, sheetsId, prospectSheetName) {
  const sheets = google.sheets({ version: 'v4', auth });
  const mappings = getProspectColumnMappings();
  const resolvedSheetName = await safeSheetName(sheets, sheetsId, prospectSheetName);
  const notesCol = getColumnLetter(mappings.NOTES);
  if (!notesCol) {
    return { success: true, sheetName: resolvedSheetName, scanned: 0, updated: 0 };
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetsId,
    range: `${resolvedSheetName}!${notesCol}2:${notesCol}`,
  });
  const rows = response.data.values || [];
  const updates = [];

  rows.forEach((row, idx) => {
    const original = String(row?.[0] || '');
    const cleaned = stripSystemTokens(original);
    if (cleaned !== original) {
      updates.push({
        range: `${resolvedSheetName}!${notesCol}${idx + 2}`,
        values: [[cleaned]],
      });
    }
  });

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetsId,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: updates,
      },
    });
  }

  rowIndexCache.delete(getCacheKey(sheetsId, resolvedSheetName));
  return {
    success: true,
    sheetName: resolvedSheetName,
    scanned: rows.length,
    updated: updates.length,
  };
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
  createProspect,
  updateProspect,
  deleteVenue,
  deleteProspect,
  cleanupProspectNotesTokens,
};
