import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import { MarkerClusterer, SuperClusterAlgorithm } from '@googlemaps/markerclusterer';
import { enrichProspect, updateVenueCoordinates } from '../services/api';
import './MapViewer.css';

// Center on Miami so the map looks ready while data loads.
const DEFAULT_CENTER = { lat: 25.79, lng: -80.20 };
const DEFAULT_ZOOM = 14;
const MAX_AUTO_FIT_ZOOM = 15;

function parseNumber(value) {
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

function getLatLng(venue) {
  const lat = parseNumber(venue.latitude);
  const lng = parseNumber(venue.longitude);
  if (lat === null || lng === null) {
    return null;
  }
  return { lat, lng };
}

function getVenueMarkerKey(venue) {
  if (!venue) {
    return '';
  }
  return String(venue.id || `${venue.recordType || 'venue'}:${venue.name || ''}`);
}

function getMapStyles(showNativePoi) {
  if (showNativePoi) {
    return null;
  }
  return [
    {
      featureType: 'poi',
      stylers: [{ visibility: 'off' }],
    },
    {
      featureType: 'poi.business',
      stylers: [{ visibility: 'off' }],
    },
  ];
}

// --- On-premise / Off-premise marker helpers ---
const VISITED_COLOR = '#22c55e';
const NOT_VISITED_COLOR = '#ef4444';
const ON_PREMISE_BORDER = '#D4A017'; // Gold
const OFF_PREMISE_BORDER = '#1E3A5F'; // Navy
const DEFAULT_BORDER = '#ffffff';
const MARKER_RADIUS = 14;
const BORDER_THICKNESS = 6;
const MARKER_RENDER_SCALE = 0.85; // 15% smaller

const CLUSTER_ZONE_COLORS = [
  '#b34a12', // Cluster 1
  '#92700e', // Cluster 2
  '#8b3a1e', // Cluster 3
  '#1E3A5F', // Cluster 4
  '#5B3A7A', // Cluster 5
  '#1a5446', // Cluster 6
  '#6b3410', // Cluster 7
];

function normalizePremise(value) {
  const v = String(value || '').toLowerCase().trim().replace(/[-_\s]/g, '');
  if (v.startsWith('on') || v === 'restaurant' || v === 'bar') return 'on';
  if (v.startsWith('off') || v === 'retail' || v === 'store' || v === 'shop') return 'off';
  return null;
}

function getClusterZoneColor(clusterName, index = 0) {
  const raw = String(clusterName || '').trim();
  const match = raw.match(/\d+/);
  const number = match ? Number.parseInt(match[0], 10) : index + 1;
  return CLUSTER_ZONE_COLORS[(number - 1) % CLUSTER_ZONE_COLORS.length];
}

function buildMarkerSvg(fillColor, borderColor, premiseType) {
  const size = (MARKER_RADIUS + BORDER_THICKNESS) * 2;
  const cx = size / 2;
  const cy = size / 2;

  let iconPath = '';
  if (premiseType === 'on') {
    // Extra-large fork/knife glyph with thicker strokes for visibility
    iconPath = `<g transform="translate(${cx - 10.5}, ${cy - 11})" fill="none" stroke="white" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <!-- Fork -->
      <line x1="2.8" y1="1.8" x2="2.8" y2="6.2"/>
      <line x1="4.4" y1="1.8" x2="4.4" y2="6.2"/>
      <line x1="6.0" y1="1.8" x2="6.0" y2="6.2"/>
      <line x1="4.4" y1="6.2" x2="4.4" y2="16.2"/>
      <!-- Knife -->
      <path d="M11.8 1.8c0 3.1 0 5.8-2.6 8.6"/>
      <line x1="9.2" y1="10.4" x2="9.2" y2="16.2"/>
    </g>`;
  } else if (premiseType === 'off') {
    // Shopping bag (scaled & centered)
    iconPath = `<g transform="translate(${cx - 8}, ${cy - 8}) scale(1.0)" fill="none" stroke="white" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="7" width="10" height="8" rx="1" fill="white" fill-opacity="0.25"/>
      <path d="M6 7V5a2.5 2.5 0 0 1 5 0v2"/>
      <line x1="5" y1="10" x2="5" y2="10.01"/>
      <line x1="11" y1="10" x2="11" y2="10.01"/>
    </g>`;
  }

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<circle cx="${cx}" cy="${cy}" r="${MARKER_RADIUS + BORDER_THICKNESS}" fill="${borderColor}" />` +
      `<circle cx="${cx}" cy="${cy}" r="${MARKER_RADIUS}" fill="${fillColor}" />` +
      iconPath +
    `</svg>`
  )}`;
}

function getMarkerIcon(google, visited, premiseType, iconCache) {
  const fillColor = visited ? VISITED_COLOR : NOT_VISITED_COLOR;
  const premise = normalizePremise(premiseType);
  const borderColor = premise === 'on' ? ON_PREMISE_BORDER : premise === 'off' ? OFF_PREMISE_BORDER : DEFAULT_BORDER;
  const cacheKey = `${fillColor}|${borderColor}|${premise || 'none'}`;
  if (iconCache?.has(cacheKey)) {
    return iconCache.get(cacheKey);
  }
  const size = (MARKER_RADIUS + BORDER_THICKNESS) * 2;
  const renderedSize = size * MARKER_RENDER_SCALE;
  const icon = {
    url: buildMarkerSvg(fillColor, borderColor, premise),
    scaledSize: new google.maps.Size(renderedSize, renderedSize),
    anchor: new google.maps.Point(renderedSize / 2, renderedSize / 2),
  };
  if (iconCache) {
    iconCache.set(cacheKey, icon);
  }
  return icon;
}

async function geocodeAddress(geocoder, address) {
  return new Promise((resolve) => {
    geocoder.geocode({ address }, (results, status) => {
      if (status === 'OK' && results?.[0]?.geometry?.location) {
        const location = results[0].geometry.location;
        resolve({ latLng: { lat: location.lat(), lng: location.lng() }, status });
        return;
      }
      resolve({ latLng: null, status });
    });
  });
}

async function geocodeWithFallbackQueries(geocoder, queries) {
  const uniqueQueries = Array.from(
    new Set(
      (Array.isArray(queries) ? queries : [])
        .map((q) => String(q || '').trim())
        .filter(Boolean)
    )
  );
  let lastStatus = null;
  for (const query of uniqueQueries) {
    const { latLng, status } = await geocodeAddress(geocoder, query);
    lastStatus = status;
    if (latLng) {
      return { latLng, status, query };
    }
  }
  return { latLng: null, status: lastStatus, query: null };
}

/**
 * Map Viewer Component
 * Renders Google Maps with markers from Sheets data.
 */
function MapViewer({
  venues,
  onVenueClick,
  selectedVenue,
  selectedVenueFocusNonce,
  clusters,
  addMode,
  onToggleAddMode,
  onMapAddPoint,
  showNativePoi,
  onToggleNativePoi,
  onVenueCoordinateResolved,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const markerIconCacheRef = useRef(new Map());
  const geocodeCacheRef = useRef(new Map());
  const failedLookupRef = useRef(new Map());
  const clustererRef = useRef(null);
  const polygonsRef = useRef([]);
  const googleRef = useRef(null);
  const geocoderRef = useRef(null);
  const geocodeJobRef = useRef(null);
  const markerRenderJobRef = useRef(null);
  const didInitialFitRef = useRef(false);
  const draftMarkerRef = useRef(null);
  const mapClickListenerRef = useRef(null);
  const [loadError, setLoadError] = useState(null);
  const [geocodeMessage, setGeocodeMessage] = useState(null);
  const [mapReadyToken, setMapReadyToken] = useState(0);
  const [markersVersion, setMarkersVersion] = useState(0);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  const fitToMarkers = useCallback(() => {
    if (!mapRef.current || !googleRef.current) {
      return;
    }
    const google = googleRef.current;
    const bounds = new google.maps.LatLngBounds();
    let markerCount = 0;
    let singlePosition = null;
    markersRef.current.forEach((marker) => {
      const position = marker.getPosition();
      if (position) {
        bounds.extend(position);
        markerCount += 1;
        singlePosition = position;
      }
    });
    if (!bounds.isEmpty()) {
      if (markerCount === 1 && singlePosition) {
        mapRef.current.setCenter(singlePosition);
        mapRef.current.setZoom(DEFAULT_ZOOM);
        return;
      }
      mapRef.current.fitBounds(bounds);
      google.maps.event.addListenerOnce(mapRef.current, 'idle', () => {
        if (!mapRef.current) {
          return;
        }
        const currentZoom = mapRef.current.getZoom();
        if (Number.isFinite(currentZoom) && currentZoom > MAX_AUTO_FIT_ZOOM) {
          mapRef.current.setZoom(MAX_AUTO_FIT_ZOOM);
        }
      });
    }
  }, []);

  const renderMarkersStaged = useCallback((markerList) => {
    if (!clustererRef.current || !mapRef.current) {
      return;
    }
    const clusterer = clustererRef.current;
    const map = mapRef.current;

    // Cancel previous staged render job if still running.
    if (markerRenderJobRef.current) {
      markerRenderJobRef.current.cancelled = true;
    }

    // Prioritize markers in current viewport for faster first interaction.
    const bounds = map.getBounds();
    const prioritized = bounds
      ? [...markerList].sort((a, b) => {
          const inA = bounds.contains(a.getPosition());
          const inB = bounds.contains(b.getPosition());
          if (inA === inB) return 0;
          return inA ? -1 : 1;
        })
      : markerList;

    clusterer.clearMarkers(true);

    const job = { cancelled: false };
    markerRenderJobRef.current = job;
    const BATCH_SIZE = 80;
    let index = 0;

    const renderChunk = () => {
      if (job.cancelled) return;
      const next = prioritized.slice(index, index + BATCH_SIZE);
      if (next.length === 0) return;
      clusterer.addMarkers(next, true);
      clusterer.render();
      index += BATCH_SIZE;
      if (index < prioritized.length) {
        requestAnimationFrame(renderChunk);
      }
    };

    renderChunk();
  }, []);

  useEffect(() => {
    if (!apiKey) {
      setLoadError('Google Maps API key not configured.');
      return;
    }

    let canceled = false;
    const loader = new Loader({
      apiKey,
      version: 'weekly',
    });

    loader
      .load()
      .then((google) => {
        if (canceled || !mapContainerRef.current) {
          return;
        }
        googleRef.current = google;
        mapRef.current = new google.maps.Map(mapContainerRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapTypeControl: false,
          fullscreenControl: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          styles: getMapStyles(showNativePoi),
        });
        geocoderRef.current = new google.maps.Geocoder();
        clustererRef.current = new MarkerClusterer({
          map: mapRef.current,
          // Show real venue markers sooner while zooming in.
          algorithm: new SuperClusterAlgorithm({
            maxZoom: 14,
            radius: 45,
            minPoints: 3,
          }),
        });
        setMapReadyToken((prev) => prev + 1);
      })
      .catch((error) => {
        if (!canceled) {
          setLoadError(error?.message || 'Failed to load Google Maps.');
        }
      });

    return () => {
      canceled = true;
      if (mapClickListenerRef.current) {
        mapClickListenerRef.current.remove();
      }
      if (draftMarkerRef.current) {
        draftMarkerRef.current.setMap(null);
      }
    };
  }, [apiKey, showNativePoi]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }
    mapRef.current.setOptions({ styles: getMapStyles(showNativePoi) });
  }, [showNativePoi]);

  useEffect(() => {
    if (!mapRef.current || !googleRef.current) {
      return;
    }
    if (mapClickListenerRef.current) {
      mapClickListenerRef.current.remove();
      mapClickListenerRef.current = null;
    }

    if (!addMode) {
      if (draftMarkerRef.current) {
        draftMarkerRef.current.setMap(null);
        draftMarkerRef.current = null;
      }
      mapRef.current.setOptions({ draggableCursor: null });
      return;
    }

    mapRef.current.setOptions({ draggableCursor: 'crosshair' });
    mapClickListenerRef.current = mapRef.current.addListener('click', (event) => {
      const lat = event?.latLng?.lat?.();
      const lng = event?.latLng?.lng?.();
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return;
      }
      if (!draftMarkerRef.current) {
        draftMarkerRef.current = new googleRef.current.maps.Marker({
          map: mapRef.current,
          position: { lat, lng },
          icon: {
            path: googleRef.current.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: '#D4A017',
            fillOpacity: 1,
            strokeColor: '#161616',
            strokeWeight: 2,
          },
        });
      } else {
        draftMarkerRef.current.setPosition({ lat, lng });
      }
      if (onMapAddPoint) {
        onMapAddPoint({ lat, lng });
      }
      if (onToggleAddMode) {
        onToggleAddMode(false);
      }
    });

    return () => {
      if (mapClickListenerRef.current) {
        mapClickListenerRef.current.remove();
        mapClickListenerRef.current = null;
      }
    };
  }, [addMode, onMapAddPoint, onToggleAddMode]);

  useEffect(() => {
    if (!mapRef.current || !googleRef.current) {
      return;
    }

    if (!venues || venues.length === 0) {
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current.clear();
      if (clustererRef.current) {
        clustererRef.current.clearMarkers();
      }
      return;
    }

    const google = googleRef.current;
    const map = mapRef.current;
    const markers = markersRef.current;
    const activeIds = new Set();
    const markerList = [];

    const queue = [];
    setGeocodeMessage(null);

    venues.forEach((venue) => {
      if (!venue?.name) {
        return;
      }
      const venueId = getVenueMarkerKey(venue);
      activeIds.add(venueId);

      const cached = geocodeCacheRef.current.get(venueId);
      const direct = getLatLng(venue);
      const latLng = direct || cached;

      if (latLng) {
        const existing = markers.get(venueId);
        if (existing) {
          existing.setPosition(latLng);
          existing.setIcon(getMarkerIcon(google, venue.visited, venue.premiseType, markerIconCacheRef.current));
          markerList.push(existing);
        } else {
          const marker = new google.maps.Marker({
            position: latLng,
            title: venue.name,
            // Let MarkerClusterer own rendering for better performance.
            icon: getMarkerIcon(google, venue.visited, venue.premiseType, markerIconCacheRef.current),
          });
          marker.addListener('click', () => {
            if (onVenueClick) {
              onVenueClick(venue.name);
            }
          });
          markers.set(venueId, marker);
          markerList.push(marker);
        }
      } else {
        const address = String(venue.address || '').trim();
        const lookupSignature = `${venue.name}__${address}`;
        const failedForSignature = failedLookupRef.current.get(venueId) === lookupSignature;
        if (!failedForSignature && (address.length > 0 || venue.name)) {
          queue.push({ ...venue, address, lookupSignature });
        }
      }
    });

    // Remove markers for venues no longer in list
    markers.forEach((marker, venueId) => {
      if (!activeIds.has(venueId)) {
        marker.setMap(null);
        markers.delete(venueId);
      }
    });

    renderMarkersStaged(markerList);

    if (markerList.length > 0 && !didInitialFitRef.current) {
      fitToMarkers();
      didInitialFitRef.current = true;
    }

    if (!geocoderRef.current || queue.length === 0) {
      return;
    }

    // Cancel previous geocode job
    if (geocodeJobRef.current) {
      geocodeJobRef.current.cancelled = true;
    }

    const job = { cancelled: false };
    geocodeJobRef.current = job;

    const runGeocode = async () => {
      let failures = 0;
      let lastStatus = null;
      let markersChanged = false;
      for (const venue of queue) {
        if (job.cancelled) {
          return;
        }
        const venueId = getVenueMarkerKey(venue);
        if (geocodeCacheRef.current.has(venueId)) {
          continue;
        }

        const geocodeQueries = [
          venue.address,
          [venue.name, venue.neighborhood, 'Miami'].filter(Boolean).join(', '),
          [venue.name, 'Miami'].filter(Boolean).join(', '),
        ];
        const { latLng: geocodedLatLng, status } = await geocodeWithFallbackQueries(
          geocoderRef.current,
          geocodeQueries
        );
        let latLng = geocodedLatLng;
        lastStatus = status;
        if (!latLng && venue.name) {
          try {
            const enrichment = await enrichProspect(venue.name, null, null);
            const suggestion = enrichment?.suggestions?.[0];
            if (Number.isFinite(Number(suggestion?.latitude)) && Number.isFinite(Number(suggestion?.longitude))) {
              latLng = {
                lat: Number(suggestion.latitude),
                lng: Number(suggestion.longitude),
              };
            }
          } catch (error) {
            // Ignore enrichment errors and keep graceful fallback behavior.
          }
        }
        if (job.cancelled) {
          return;
        }
        if (latLng) {
          geocodeCacheRef.current.set(venueId, latLng);
          failedLookupRef.current.delete(venueId);
          if (venue.recordType !== 'prospect') {
            updateVenueCoordinates(venue.name, latLng.lat, latLng.lng).catch((error) => {
              console.warn('Failed to save coordinates:', error?.message || error);
            });
          }
          if (onVenueCoordinateResolved) {
            onVenueCoordinateResolved(venue.name, latLng.lat, latLng.lng);
          }
          const marker = new google.maps.Marker({
            position: latLng,
            title: venue.name,
            icon: getMarkerIcon(google, venue.visited, venue.premiseType, markerIconCacheRef.current),
          });
          marker.addListener('click', () => {
            if (onVenueClick) {
              onVenueClick(venue.name);
            }
          });
          markers.set(venueId, marker);
          markersChanged = true;
          if (clustererRef.current) {
            clustererRef.current.addMarkers([marker]);
          }
        } else {
          failedLookupRef.current.set(venueId, venue.lookupSignature);
          failures += 1;
        }

        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      if (markers.size === 0 && queue.length > 0) {
        const statusText = lastStatus ? ` (${lastStatus})` : '';
        setGeocodeMessage(
          `No markers yet. Geocoding failed${statusText}. ` +
            'Enable the Geocoding API, ensure billing is on, and restrict your API key to Maps JavaScript + Geocoding.'
        );
      } else if (failures > 0) {
        setGeocodeMessage('Some addresses could not be geocoded.');
      }
      if (markersChanged) {
        setMarkersVersion((prev) => prev + 1);
      }
    };

    runGeocode();
  }, [venues, onVenueClick, fitToMarkers, renderMarkersStaged, onVenueCoordinateResolved]);

  useEffect(() => {
    if (!selectedVenue || !mapRef.current || !googleRef.current) {
      return;
    }
    const venueId = getVenueMarkerKey(selectedVenue);
    if (!venueId) {
      return;
    }
    const focusMap = (target) => {
      mapRef.current.panTo(target);
      mapRef.current.setZoom(19);
      // Re-apply focus after layout settles (mobile overlays can mask first pan).
      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.panTo(target);
          mapRef.current.setZoom(19);
        }
      }, 120);
    };
    const existingMarker = markersRef.current.get(venueId);

    if (existingMarker?.getPosition()) {
      focusMap(existingMarker.getPosition());
      return;
    }
    const direct = getLatLng(selectedVenue);
    if (direct) {
      focusMap(direct);
      return;
    }

    const hasAddress = typeof selectedVenue.address === 'string' && selectedVenue.address.trim().length > 0;
    const fallbackQuery = hasAddress
      ? selectedVenue.address
      : [selectedVenue.name, selectedVenue.neighborhood, 'Miami']
          .filter(Boolean)
          .join(', ');

    if (!geocoderRef.current || !fallbackQuery) {
      if (existingMarker?.getPosition()) {
        focusMap(existingMarker.getPosition());
      }
      return;
    }

    let cancelled = false;
    geocodeWithFallbackQueries(geocoderRef.current, [
      selectedVenue.address,
      [selectedVenue.name, selectedVenue.neighborhood, 'Miami'].filter(Boolean).join(', '),
      [selectedVenue.name, 'Miami'].filter(Boolean).join(', '),
      fallbackQuery,
    ])
      .then(async ({ latLng }) => {
        if (cancelled || !mapRef.current) {
          return;
        }
        if (latLng) {
          focusMap(latLng);
          if (onVenueCoordinateResolved) {
            onVenueCoordinateResolved(selectedVenue.name, latLng.lat, latLng.lng);
          }
          return;
        }

        try {
          const enrichment = await enrichProspect(selectedVenue.name, null, null);
          const suggestion = enrichment?.suggestions?.[0];
          const candidateLat = Number(suggestion?.latitude);
          const candidateLng = Number(suggestion?.longitude);
          if (!cancelled && Number.isFinite(candidateLat) && Number.isFinite(candidateLng)) {
            const enrichedLatLng = { lat: candidateLat, lng: candidateLng };
            focusMap(enrichedLatLng);
            if (onVenueCoordinateResolved) {
              onVenueCoordinateResolved(selectedVenue.name, enrichedLatLng.lat, enrichedLatLng.lng);
            }
            return;
          }
        } catch (error) {
          // Ignore enrichment failure in focus fallback.
        }

        if (existingMarker?.getPosition()) {
          focusMap(existingMarker.getPosition());
        }
      })
      .catch(() => {
        if (!cancelled && existingMarker?.getPosition()) {
          focusMap(existingMarker.getPosition());
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedVenue, selectedVenueFocusNonce, onVenueCoordinateResolved, mapReadyToken, markersVersion]);

  useEffect(() => {
    if (!mapRef.current || !googleRef.current) {
      return;
    }
    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];
    if (!clusters || clusters.length === 0) {
      return;
    }
    clusters.forEach((cluster, index) => {
      const paths = Array.isArray(cluster.paths) ? cluster.paths : [];
      if (paths.length === 0) {
        return;
      }
      const zoneColor = getClusterZoneColor(cluster.name, index);
      const polygon = new google.maps.Polygon({
        paths,
        // Force deterministic per-cluster colors so zones are clearly distinct.
        strokeColor: zoneColor,
        strokeOpacity: 0.88,
        strokeWeight: 3,
        fillColor: zoneColor,
        fillOpacity: 0.2,
        clickable: false,
        zIndex: 2,
      });
      polygon.setMap(mapRef.current);
      polygonsRef.current.push(polygon);
    });
  }, [clusters]);

  if (loadError) {
    return (
      <div className="map-viewer-error">
        <p>Google Maps failed to load.</p>
        <p>{loadError}</p>
        <p>Please set VITE_GOOGLE_MAPS_API_KEY.</p>
      </div>
    );
  }

  return (
    <div className="map-viewer-container map-viewer-map" ref={mapContainerRef}>
      <button className="map-fit-button" onClick={fitToMarkers} type="button" aria-label="Fit to markers" title="Fit to markers">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6V3a1 1 0 0 1 1-1h3"/>
          <path d="M12 2h3a1 1 0 0 1 1 1v3"/>
          <path d="M16 12v3a1 1 0 0 1-1 1h-3"/>
          <path d="M6 16H3a1 1 0 0 1-1-1v-3"/>
          <circle cx="9" cy="9" r="2.5"/>
        </svg>
      </button>
      <button
        className={`map-add-button ${addMode ? 'map-add-button--active' : ''}`}
        onClick={() => onToggleAddMode && onToggleAddMode(!addMode)}
        type="button"
        aria-label={addMode ? 'Cancel add venue mode' : 'Add venue mode'}
        title={addMode ? 'Cancel add venue mode' : 'Add venue mode'}
      >
        +
      </button>
      <button
        className={`map-poi-toggle ${showNativePoi ? 'map-poi-toggle--active' : ''}`}
        onClick={() => onToggleNativePoi && onToggleNativePoi(!showNativePoi)}
        type="button"
        aria-label={showNativePoi ? 'Hide native map POI' : 'Show native map POI'}
        title={showNativePoi ? 'Hide native map POI' : 'Show native map POI'}
      >
        POI
      </button>
      {geocodeMessage && (
        <div className="map-viewer-warning">
          {geocodeMessage}
        </div>
      )}
    </div>
  );
}

export default MapViewer;
