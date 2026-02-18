/**
 * API client for Google Cloud Functions
 * 
 * Design Decision: Polling-based sync (60 seconds)
 * Immediate UI updates after user actions, full consistency via polling
 */

import axios from 'axios';

// Cloud Functions base URL - set via environment variable or default
// Default uses the current host so LAN access "just works" on phones.
const fallbackHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

function isLocalHostname(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '0.0.0.0';
}

function resolveApiBaseUrl() {
  const configured = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  if (!configured) {
    return `http://${fallbackHost}:9090`;
  }
  if (typeof window === 'undefined') {
    return configured;
  }

  // If frontend is opened from another device on LAN, avoid using localhost API targets.
  try {
    const parsed = new URL(configured);
    const currentHost = window.location.hostname;
    if (!isLocalHostname(currentHost) && isLocalHostname(parsed.hostname)) {
      const port = parsed.port || '9090';
      const pathname = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
      return `${parsed.protocol}//${currentHost}:${port}${pathname}`;
    }
    return configured;
  } catch (error) {
    return configured;
  }
}

const API_BASE_URL = resolveApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Get all venues with current status
 * Used by polling service
 */
export async function getVenues() {
  try {
    const response = await api.get('/api/venues');
    return response.data;
  } catch (error) {
    console.error('Error fetching venues:', error);
    throw error;
  }
}

/**
 * Update visited status for a venue
 * Updates Sheets (source of truth) and My Maps
 */
export async function updateVisitedStatus(venueName, visited) {
  try {
    const response = await api.post(`/api/venues/${encodeURIComponent(venueName)}/visited`, {
      visited,
    });
    return response.data;
  } catch (error) {
    console.error('Error updating visited status:', error);
    throw error;
  }
}

/**
 * Update latitude/longitude for a venue
 */
export async function updateVenueCoordinates(venueName, latitude, longitude) {
  try {
    const response = await api.post(`/api/venues/${encodeURIComponent(venueName)}/coordinates`, {
      latitude,
      longitude,
    });
    return response.data;
  } catch (error) {
    console.error('Error updating venue coordinates:', error);
    throw error;
  }
}

export async function enrichProspect(venueName, latitude, longitude) {
  try {
    const response = await api.post('/api/prospects/enrich', {
      venueName,
      latitude,
      longitude,
    });
    return response.data;
  } catch (error) {
    console.error('Error enriching prospect:', error);
    throw error;
  }
}

export async function createProspect(payload) {
  try {
    const response = await api.post('/api/prospects', payload);
    return response.data;
  } catch (error) {
    console.error('Error creating prospect:', error);
    throw error;
  }
}

export async function updateProspect(identifier, payload) {
  try {
    const response = await api.patch(`/api/prospects/${encodeURIComponent(identifier)}`, payload);
    return response.data;
  } catch (error) {
    console.error('Error updating prospect:', error);
    throw error;
  }
}

export async function deleteProspect(identifier) {
  try {
    const response = await api.delete(`/api/prospects/${encodeURIComponent(identifier)}`);
    return response.data;
  } catch (error) {
    console.error('Error deleting prospect:', error);
    throw error;
  }
}

export async function deleteVenue(venueName) {
  try {
    const response = await api.delete(`/api/venues/${encodeURIComponent(venueName)}`);
    return response.data;
  } catch (error) {
    console.error('Error deleting venue:', error);
    throw error;
  }
}

/**
 * Trigger manual sync
 */
export async function triggerSync() {
  try {
    const response = await api.get('/api/sync');
    return response.data;
  } catch (error) {
    console.error('Error triggering sync:', error);
    throw error;
  }
}

/**
 * Get cluster polygons from My Maps
 */
export async function getClusterPolygons() {
  try {
    const response = await api.get('/api/clusters');
    return response.data;
  } catch (error) {
    console.error('Error fetching cluster polygons:', error);
    throw error;
  }
}

/**
 * Health check
 */
export async function healthCheck() {
  try {
    const response = await api.get('/api/health');
    return response.data;
  } catch (error) {
    console.error('Error checking health:', error);
    throw error;
  }
}
