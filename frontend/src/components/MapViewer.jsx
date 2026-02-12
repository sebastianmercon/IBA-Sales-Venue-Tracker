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

function getMarkerIcon(google, visited) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: visited ? '#22c55e' : '#ef4444',
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
    scale: 10.5,
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
          existing.setIcon(getMarkerIcon(google, venue.visited));
          markerList.push(existing);
        } else {
          const marker = new google.maps.Marker({
            map,
            position: latLng,
            title: venue.name,
            icon: getMarkerIcon(google, venue.visited),
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
            icon: getMarkerIcon(google, venue.visited),
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
