/**
 * Google My Maps integration via Google Drive API
 * 
 * Design Decision: My Maps files are stored as KML/KMZ in Google Drive
 * We download, parse, modify, and re-upload the KML file to update placemarks
 * 
 * Note: My Maps API limitations require file manipulation rather than direct API calls
 * Updates may be delayed - system designed for eventual consistency
 */

const { google } = require('googleapis');
const { XMLParser } = require('fast-xml-parser');
const { parseKML, generateKML, syncVenuesToKML } = require('../utils/kml');

/**
 * Download My Maps KML file from Google Drive
 * Returns KML content as string
 */
async function downloadMyMapsKML(auth, mapsFileId) {
  const drive = google.drive({ version: 'v3', auth });
  
  try {
    // Download the file
    const response = await drive.files.get(
      { fileId: mapsFileId, alt: 'media' },
      { responseType: 'text' }
    );

    return response.data;
  } catch (error) {
    console.error('Error downloading My Maps KML:', error.message);
    throw new Error(`Failed to download My Maps file: ${error.message}`);
  }
}

/**
 * Upload updated KML file to Google Drive
 * Replaces the existing My Maps file
 */
async function uploadMyMapsKML(auth, mapsFileId, kmlContent) {
  const drive = google.drive({ version: 'v3', auth });
  
  try {
    // Update the file with new KML content
    await drive.files.update({
      fileId: mapsFileId,
      media: {
        mimeType: 'application/vnd.google-earth.kml+xml',
        body: kmlContent,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Error uploading My Maps KML:', error.message);
    throw new Error(`Failed to upload My Maps file: ${error.message}`);
  }
}

/**
 * Read placemarks from My Maps
 * Downloads and parses KML file
 */
async function readMyMapsPlacemarks(auth, mapsFileId) {
  try {
    const kmlContent = await downloadMyMapsKML(auth, mapsFileId);
    const { placemarks } = parseKML(kmlContent);
    return placemarks;
  } catch (error) {
    console.error('Error reading My Maps placemarks:', error.message);
    throw error;
  }
}

/**
 * Sync venues to My Maps
 * Updates placemark colors based on visited status from Sheets
 * 
 * Design Decision: Sheets is source of truth, so we sync Sheets -> Maps
 * This function updates My Maps to match Sheets state
 */
async function syncVenuesToMaps(auth, mapsFileId, venues) {
  try {
    // Download current KML
    const kmlContent = await downloadMyMapsKML(auth, mapsFileId);
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: true,
    });
    
    const kmlJson = parser.parse(kmlContent);

    // Sync venues to KML structure
    const updatedKmlJson = syncVenuesToKML(kmlJson, venues);

    // Generate new KML
    const newKmlContent = generateKML(updatedKmlJson);

    // Upload updated KML
    await uploadMyMapsKML(auth, mapsFileId, newKmlContent);

    return { success: true, updated: venues.length };
  } catch (error) {
    console.error('Error syncing venues to My Maps:', error.message);
    // Note: My Maps updates may be delayed - this is expected behavior
    throw new Error(`Failed to sync venues to My Maps: ${error.message}`);
  }
}

/**
 * Update a single placemark color in My Maps
 * Used for immediate updates after user action
 */
async function updatePlacemarkColor(auth, mapsFileId, venueName, visited) {
  try {
    // Download current KML
    const kmlContent = await downloadMyMapsKML(auth, mapsFileId);
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: true,
    });
    
    const kmlJson = parser.parse(kmlContent);
    const { updatePlacemarkColor: updateColor } = require('../utils/kml');

    // Update placemark color
    const updatedKmlJson = updateColor(kmlJson, venueName, visited);

    // Generate new KML
    const newKmlContent = generateKML(updatedKmlJson);

    // Upload updated KML
    await uploadMyMapsKML(auth, mapsFileId, newKmlContent);

    return { success: true };
  } catch (error) {
    console.error('Error updating placemark color:', error.message);
    // Note: My Maps updates may be delayed - this is expected behavior
    throw new Error(`Failed to update placemark color: ${error.message}`);
  }
}

module.exports = {
  readMyMapsPlacemarks,
  syncVenuesToMaps,
  updatePlacemarkColor,
};
