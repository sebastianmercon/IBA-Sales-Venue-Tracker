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
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `http://${fallbackHost}:9090`;

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
