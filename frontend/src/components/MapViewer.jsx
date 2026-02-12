import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { updateVenueCoordinates } from '../services/api';
import './MapViewer.css';

const DEFAULT_CENTER = { lat: 27.8, lng: -81.7 };
const DEFAULT_ZOOM = 6;

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

// --- On-premise / Off-premise marker helpers ---
const VISITED_COLOR = '#22c55e';
const NOT_VISITED_COLOR = '#ef4444';
const ON_PREMISE_BORDER = '#D4A017'; // Gold
const OFF_PREMISE_BORDER = '#1E3A5F'; // Navy
const DEFAULT_BORDER = '#ffffff';
const MARKER_RADIUS = 14;
const BORDER_THICKNESS = 6;
const MARKER_RENDER_SCALE = 0.85; // 15% smaller

function normalizePremise(value) {
  const v = String(value || '').toLowerCase().trim().replace(/[-_\s]/g, '');
  if (v.startsWith('on') || v === 'restaurant' || v === 'bar') return 'on';
  if (v.startsWith('off') || v === 'retail' || v === 'store' || v === 'shop') return 'off';
  return null;
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

function getMarkerIcon(google, visited, premiseType) {
  const fillColor = visited ? VISITED_COLOR : NOT_VISITED_COLOR;
  const premise = normalizePremise(premiseType);
  const borderColor = premise === 'on' ? ON_PREMISE_BORDER : premise === 'off' ? OFF_PREMISE_BORDER : DEFAULT_BORDER;
  const size = (MARKER_RADIUS + BORDER_THICKNESS) * 2;
  const renderedSize = size * MARKER_RENDER_SCALE;
  return {
    url: buildMarkerSvg(fillColor, borderColor, premise),
    scaledSize: new google.maps.Size(renderedSize, renderedSize),
    anchor: new google.maps.Point(renderedSize / 2, renderedSize / 2),
  };
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

/**
 * Map Viewer Component
 * Renders Google Maps with markers from Sheets data.
 */
function MapViewer({ venues, onVenueClick, selectedVenue, clusters }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const geocodeCacheRef = useRef(new Map());
  const clustererRef = useRef(null);
  const polygonsRef = useRef([]);
  const googleRef = useRef(null);
  const geocoderRef = useRef(null);
  const geocodeJobRef = useRef(null);
  const didInitialFitRef = useRef(false);
  const [loadError, setLoadError] = useState(null);
  const [geocodeMessage, setGeocodeMessage] = useState(null);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  const fitToMarkers = useCallback(() => {
    if (!mapRef.current || !googleRef.current) {
      return;
    }
    const google = googleRef.current;
    const bounds = new google.maps.LatLngBounds();
    markersRef.current.forEach((marker) => {
      const position = marker.getPosition();
      if (position) {
        bounds.extend(position);
      }
    });
    if (!bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds);
    }
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
        });
        geocoderRef.current = new google.maps.Geocoder();
        clustererRef.current = new MarkerClusterer({ map: mapRef.current });
      })
      .catch((error) => {
        if (!canceled) {
          setLoadError(error?.message || 'Failed to load Google Maps.');
        }
      });

    return () => {
      canceled = true;
    };
  }, [apiKey]);

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
      const venueId = venue.name;
      activeIds.add(venueId);

      const cached = geocodeCacheRef.current.get(venueId);
      const direct = getLatLng(venue);
      const latLng = direct || cached;

      if (latLng) {
        const existing = markers.get(venueId);
        if (existing) {
          existing.setPosition(latLng);
          existing.setIcon(getMarkerIcon(google, venue.visited, venue.premiseType));
          markerList.push(existing);
        } else {
          const marker = new google.maps.Marker({
            map,
            position: latLng,
            title: venue.name,
            icon: getMarkerIcon(google, venue.visited, venue.premiseType),
          });
          marker.addListener('click', () => {
            if (onVenueClick) {
              onVenueClick(venue.name);
            }
          });
          markers.set(venueId, marker);
          markerList.push(marker);
        }
      } else if (venue.address) {
        queue.push(venue);
      }
    });

    // Remove markers for venues no longer in list
    markers.forEach((marker, venueId) => {
      if (!activeIds.has(venueId)) {
        marker.setMap(null);
        markers.delete(venueId);
      }
    });

    if (clustererRef.current) {
      clustererRef.current.clearMarkers();
      clustererRef.current.addMarkers(markerList);
    }

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
      for (const venue of queue) {
        if (job.cancelled) {
          return;
        }
        const venueId = venue.name;
        if (geocodeCacheRef.current.has(venueId)) {
          continue;
        }

        const { latLng, status } = await geocodeAddress(geocoderRef.current, venue.address);
        lastStatus = status;
        if (job.cancelled) {
          return;
        }
        if (latLng) {
          geocodeCacheRef.current.set(venueId, latLng);
          updateVenueCoordinates(venue.name, latLng.lat, latLng.lng).catch((error) => {
            console.warn('Failed to save coordinates:', error?.message || error);
          });
          const marker = new google.maps.Marker({
            map,
            position: latLng,
            title: venue.name,
            icon: getMarkerIcon(google, venue.visited, venue.premiseType),
          });
          marker.addListener('click', () => {
            if (onVenueClick) {
              onVenueClick(venue.name);
            }
          });
          markers.set(venueId, marker);
          if (clustererRef.current) {
            clustererRef.current.addMarkers([marker]);
          }
        } else {
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
    };

    runGeocode();
  }, [venues, onVenueClick, fitToMarkers]);

  useEffect(() => {
    if (!selectedVenue || !mapRef.current || !googleRef.current) {
      return;
    }
    const venueId = selectedVenue.name;
    if (!venueId) {
      return;
    }
    const existingMarker = markersRef.current.get(venueId);
    if (existingMarker?.getPosition()) {
      mapRef.current.panTo(existingMarker.getPosition());
      mapRef.current.setZoom(19);
      return;
    }
    const direct = getLatLng(selectedVenue);
    if (direct) {
      mapRef.current.panTo(direct);
      mapRef.current.setZoom(19);
    }
  }, [selectedVenue]);

  useEffect(() => {
    if (!mapRef.current || !googleRef.current) {
      return;
    }
    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];
    if (!clusters || clusters.length === 0) {
      return;
    }
    const google = googleRef.current;
    clusters.forEach((cluster) => {
      const paths = Array.isArray(cluster.paths) ? cluster.paths : [];
      if (paths.length === 0) {
        return;
      }
      const polygon = new google.maps.Polygon({
        paths,
        strokeColor: cluster.strokeColor || '#6b4f2a',
        strokeOpacity: cluster.strokeOpacity ?? 0.6,
        strokeWeight: cluster.strokeWeight || 2,
        fillColor: cluster.fillColor || cluster.strokeColor || '#d9c3a1',
        fillOpacity: cluster.fillOpacity ?? 0.2,
        clickable: false,
        zIndex: 1,
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
      <button className="map-fit-button" onClick={fitToMarkers} type="button">
        Fit to markers
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
