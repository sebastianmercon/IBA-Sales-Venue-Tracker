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

function normalizeArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function collectPlacemarks(container) {
  const placemarks = [];
  if (!container) {
    return placemarks;
  }

  placemarks.push(...normalizeArray(container.Placemark));
  for (const folder of normalizeArray(container.Folder)) {
    placemarks.push(...collectPlacemarks(folder));
  }

  return placemarks;
}

function readText(value) {
  return value?.['#text'] || value || '';
}

function parseKmlColor(value) {
  if (!value) {
    return null;
  }
  const raw = String(value).replace('#', '').trim();
  if (raw.length !== 8 && raw.length !== 6) {
    return null;
  }
  let aa = 'ff';
  let rr = '00';
  let gg = '00';
  let bb = '00';
  if (raw.length === 8) {
    aa = raw.slice(0, 2);
    bb = raw.slice(2, 4);
    gg = raw.slice(4, 6);
    rr = raw.slice(6, 8);
  } else {
    rr = raw.slice(0, 2);
    gg = raw.slice(2, 4);
    bb = raw.slice(4, 6);
  }
  return {
    color: `#${rr}${gg}${bb}`,
    opacity: Number.parseInt(aa, 16) / 255,
  };
}

function extractCoordinates(coordinatesText) {
  const text = String(coordinatesText || '').trim();
  if (!text) {
    return [];
  }
  return text
    .split(/\s+/)
    .map((pair) => {
      const [lng, lat] = pair.split(',').map((value) => Number.parseFloat(value));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }
      return { lat, lng };
    })
    .filter(Boolean);
}

function resolveStyle(document, styleUrl) {
  const styleId = String(styleUrl || '').replace('#', '');
  if (!styleId) {
    return null;
  }
  const styles = normalizeArray(document.Style);
  const styleMaps = normalizeArray(document.StyleMap);
  let resolvedId = styleId;

  const styleMap = styleMaps.find((entry) => entry['@_id'] === styleId);
  if (styleMap) {
    const pairs = normalizeArray(styleMap.Pair);
    const normalPair = pairs.find((pair) => readText(pair.key) === 'normal') || pairs[0];
    const mapStyleUrl = readText(normalPair?.styleUrl);
    if (mapStyleUrl) {
      resolvedId = mapStyleUrl.replace('#', '');
    }
  }

  const style = styles.find((entry) => entry['@_id'] === resolvedId);
  if (!style) {
    return null;
  }

  const lineStyle = style.LineStyle || {};
  const polyStyle = style.PolyStyle || {};
  const stroke = parseKmlColor(readText(lineStyle.color));
  const fill = parseKmlColor(readText(polyStyle.color));

  return {
    strokeColor: stroke?.color || null,
    strokeOpacity: stroke?.opacity ?? null,
    strokeWeight: Number.parseFloat(readText(lineStyle.width)) || null,
    fillColor: fill?.color || null,
    fillOpacity: fill?.opacity ?? null,
  };
}

function extractPolygonsFromPlacemark(placemark) {
  const polygons = [];
  const direct = normalizeArray(placemark.Polygon);
  const multi = normalizeArray(placemark.MultiGeometry?.Polygon);
  const allPolygons = [...direct, ...multi];

  for (const polygon of allPolygons) {
    const ring = polygon?.outerBoundaryIs?.LinearRing?.coordinates;
    const coords = extractCoordinates(readText(ring));
    if (coords.length === 0) {
      continue;
    }
    polygons.push({
      paths: [coords],
    });
  }
  return polygons;
}

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
    const placemarkArray = collectPlacemarks(document);

    for (const placemark of placemarkArray) {
      const name = readText(placemark.name);
      const coordinates = readText(placemark.Point?.coordinates);
      const styleUrl = readText(placemark.styleUrl);
      
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
 * Parse KML content and extract polygon overlays
 * Returns array of { name, paths, strokeColor, strokeOpacity, strokeWeight, fillColor, fillOpacity }
 */
function parseKMLPolygons(kmlContent) {
  try {
    const json = parser.parse(kmlContent);
    const document = json.kml?.Document || json.kml?.Folder || {};
    const placemarkArray = collectPlacemarks(document);
    const polygons = [];

    for (const placemark of placemarkArray) {
      const name = readText(placemark.name);
      const styleUrl = readText(placemark.styleUrl);
      const style = resolveStyle(document, styleUrl) || {};
      const rings = extractPolygonsFromPlacemark(placemark);
      rings.forEach((ring) => {
        polygons.push({
          name,
          paths: ring.paths,
          strokeColor: style.strokeColor,
          strokeOpacity: style.strokeOpacity,
          strokeWeight: style.strokeWeight,
          fillColor: style.fillColor,
          fillOpacity: style.fillOpacity,
        });
      });
    }

    return { polygons, document };
  } catch (error) {
    console.error('Error parsing KML polygons:', error.message);
    throw new Error('Failed to parse KML polygons');
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
  parseKMLPolygons,
  updatePlacemarkColor,
  generateKML,
  syncVenuesToKML,
};
