/**
 * KML parser and generator for Google My Maps
 * 
 * Design Decision: My Maps files are stored as KML/KMZ in Google Drive
 * We parse KML, update placemark styles, and regenerate the file
 * 
 * Note: My Maps API limitations require file manipulation rather than direct API calls
 */

const { XMLParser, XMLBuilder } = require('fast-xml-parser');

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
};

const parser = new XMLParser(parserOptions);
const builder = new XMLBuilder(parserOptions);

/**
 * Parse KML content and extract placemarks
 * Returns array of { id, name, coordinates, styleUrl }
 */
function parseKML(kmlContent) {
  try {
    const json = parser.parse(kmlContent);
    const placemarks = [];
    
    // KML structure: kml > Document > Placemark[]
    const document = json.kml?.Document || json.kml?.Folder || {};
    const placemarkArray = Array.isArray(document.Placemark) 
      ? document.Placemark 
      : (document.Placemark ? [document.Placemark] : []);

    for (const placemark of placemarkArray) {
      const name = placemark.name?.['#text'] || placemark.name || '';
      const coordinates = placemark.Point?.coordinates?.['#text'] || 
                         placemark.Point?.coordinates || '';
      const styleUrl = placemark.styleUrl?.['#text'] || placemark.styleUrl || '';
      
      // Extract ID from styleUrl or use name as identifier
      const id = styleUrl.replace('#', '') || name.toLowerCase().replace(/\s+/g, '-');

      placemarks.push({
        id,
        name,
        coordinates,
        styleUrl,
        raw: placemark,
      });
    }

    return { placemarks, document };
  } catch (error) {
    console.error('Error parsing KML:', error.message);
    throw new Error('Failed to parse KML file');
  }
}

/**
 * Update placemark color in KML structure
 * Creates or updates Style definitions for visited/not visited states
 */
function updatePlacemarkColor(kmlJson, placemarkName, visited) {
  const document = kmlJson.kml?.Document || kmlJson.kml?.Folder || {};
  
  // Ensure StyleMap exists
  if (!document.StyleMap) {
    document.StyleMap = [];
  }
  if (!Array.isArray(document.StyleMap)) {
    document.StyleMap = [document.StyleMap];
  }

  // Ensure Style definitions exist
  if (!document.Style) {
    document.Style = [];
  }
  if (!Array.isArray(document.Style)) {
    document.Style = [document.Style];
  }

  const color = visited ? '#00FF00' : '#FF0000';
  const styleId = `style-${placemarkName.toLowerCase().replace(/\s+/g, '-')}`;
  
  // Find or create placemark
  const placemarkArray = Array.isArray(document.Placemark) 
    ? document.Placemark 
    : (document.Placemark ? [document.Placemark] : []);

  let placemark = placemarkArray.find(p => 
    (p.name?.['#text'] || p.name || '').toLowerCase() === placemarkName.toLowerCase()
  );

  if (!placemark) {
    // Create new placemark if not found
    placemark = {
      name: { '#text': placemarkName },
      Point: { coordinates: { '#text': '0,0,0' } },
    };
    placemarkArray.push(placemark);
  }

  // Set style URL
  placemark.styleUrl = { '#text': `#${styleId}` };

  // Create or update style
  let style = document.Style.find(s => s['@_id'] === styleId);
  if (!style) {
    style = {
      '@_id': styleId,
      IconStyle: {
        Icon: {
          href: { '#text': 'http://maps.google.com/mapfiles/ms/icons/red-dot.png' },
        },
        color: { '#text': color },
      },
    };
    document.Style.push(style);
  } else {
    if (!style.IconStyle) {
      style.IconStyle = {};
    }
    if (!style.IconStyle.color) {
      style.IconStyle.color = {};
    }
    style.IconStyle.color['#text'] = color;
    
    // Update icon based on color
    const iconColor = visited ? 'green' : 'red';
    if (!style.IconStyle.Icon) {
      style.IconStyle.Icon = {};
    }
    style.IconStyle.Icon.href = { 
      '#text': `http://maps.google.com/mapfiles/ms/icons/${iconColor}-dot.png` 
    };
  }

  // Update document structure
  if (!kmlJson.kml) {
    kmlJson.kml = {};
  }
  if (!kmlJson.kml.Document) {
    kmlJson.kml.Document = document;
  }
  kmlJson.kml.Document.Placemark = placemarkArray;
  kmlJson.kml.Document.Style = document.Style;

  return kmlJson;
}

/**
 * Generate KML XML from JSON structure
 */
function generateKML(kmlJson) {
  try {
    const xml = builder.build(kmlJson);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
  } catch (error) {
    console.error('Error generating KML:', error.message);
    throw new Error('Failed to generate KML file');
  }
}

/**
 * Sync all venues to KML structure
 * Updates placemark colors based on visited status
 */
function syncVenuesToKML(kmlJson, venues) {
  const document = kmlJson.kml?.Document || kmlJson.kml?.Folder || {};
  
  // Initialize structures
  if (!document.Style) {
    document.Style = [];
  }
  if (!Array.isArray(document.Style)) {
    document.Style = [document.Style];
  }
  if (!document.Placemark) {
    document.Placemark = [];
  }
  if (!Array.isArray(document.Placemark)) {
    document.Placemark = [document.Placemark];
  }

  // Create style definitions
  const visitedStyle = {
    '@_id': 'style-visited',
    IconStyle: {
      Icon: {
        href: { '#text': 'http://maps.google.com/mapfiles/ms/icons/green-dot.png' },
      },
      color: { '#text': '#00FF00' },
    },
  };

  const notVisitedStyle = {
    '@_id': 'style-not-visited',
    IconStyle: {
      Icon: {
        href: { '#text': 'http://maps.google.com/mapfiles/ms/icons/red-dot.png' },
      },
      color: { '#text': '#FF0000' },
    },
  };

  // Add or update styles
  const visitedStyleIndex = document.Style.findIndex(s => s['@_id'] === 'style-visited');
  const notVisitedStyleIndex = document.Style.findIndex(s => s['@_id'] === 'style-not-visited');
  
  if (visitedStyleIndex >= 0) {
    document.Style[visitedStyleIndex] = visitedStyle;
  } else {
    document.Style.push(visitedStyle);
  }
  
  if (notVisitedStyleIndex >= 0) {
    document.Style[notVisitedStyleIndex] = notVisitedStyle;
  } else {
    document.Style.push(notVisitedStyle);
  }

  // Update or create placemarks for each venue
  for (const venue of venues) {
    const placemarkName = venue.name;
    const visited = venue.visited === true || venue.visited === 'TRUE';
    
    let placemark = document.Placemark.find(p => 
      (p.name?.['#text'] || p.name || '').toLowerCase() === placemarkName.toLowerCase()
    );

    if (!placemark) {
      // Create new placemark
      const coords = venue.longitude && venue.latitude 
        ? `${venue.longitude},${venue.latitude},0`
        : '0,0,0';
      
      placemark = {
        name: { '#text': placemarkName },
        description: { 
          '#text': `Address: ${venue.address}\nCluster: ${venue.clusterId}` 
        },
        Point: {
          coordinates: { '#text': coords },
        },
        styleUrl: { '#text': `#${visited ? 'style-visited' : 'style-not-visited'}` },
      };
      document.Placemark.push(placemark);
    } else {
      // Update existing placemark
      placemark.styleUrl = { 
        '#text': `#${visited ? 'style-visited' : 'style-not-visited'}` 
      };
      
      // Update description if needed
      if (placemark.description) {
        placemark.description['#text'] = 
          `Address: ${venue.address}\nCluster: ${venue.clusterId}`;
      } else {
        placemark.description = { 
          '#text': `Address: ${venue.address}\nCluster: ${venue.clusterId}` 
        };
      }
    }
  }

  // Update document structure
  if (!kmlJson.kml) {
    kmlJson.kml = {};
  }
  kmlJson.kml.Document = document;

  return kmlJson;
}

module.exports = {
  parseKML,
  updatePlacemarkColor,
  generateKML,
  syncVenuesToKML,
};
