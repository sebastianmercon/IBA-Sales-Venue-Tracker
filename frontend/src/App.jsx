import React, { useState, useEffect, useCallback } from 'react';
import MapViewer from './components/MapViewer';
import VenuePanel from './components/VenuePanel';
import PollingService from './services/polling';
import { getVenues } from './services/api';
import './App.css';

/**
 * Main App Component
 * 
 * Design Decision: Polling every 60 seconds
 * Immediate UI updates after user actions, full consistency via polling
 */
function App() {
  const [venues, setVenues] = useState([]);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [venueQuery, setVenueQuery] = useState('');
  const pollingServiceRef = React.useRef(null);
  const normalizeName = useCallback((value) => String(value || '').trim().toLowerCase(), []);

  // Initialize polling service
  useEffect(() => {
    const pollingInterval = 60000; // 60 seconds
    pollingServiceRef.current = new PollingService(
      (updatedVenues, timestamp) => {
        setVenues(updatedVenues);
        setLastSync(timestamp || new Date().toISOString());
        setError(null);
      },
      pollingInterval
    );

    // Load initial data
    loadVenues();

    // Start polling
    pollingServiceRef.current.start();

    // Cleanup on unmount
    return () => {
      if (pollingServiceRef.current) {
        pollingServiceRef.current.stop();
      }
    };
  }, []);

  /**
   * Load venues from API
   */
  const loadVenues = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getVenues();
      setVenues(data.venues || []);
      setLastSync(data.timestamp || new Date().toISOString());
    } catch (err) {
      console.error('Error loading venues:', err);
      setError('Failed to load venues. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle placemark click from map
   * Note: My Maps iframe may not support direct click events
   * This is a placeholder for future integration
   */
  const handlePlacemarkClick = useCallback((venueName) => {
    const normalizedTarget = normalizeName(venueName);
    const venue = venues.find(
      v => normalizeName(v.name) === normalizedTarget
    );
    if (venue) {
      setSelectedVenue(venue);
    }
  }, [venues, normalizeName]);

  /**
   * Handle manual venue selection (for testing or future features)
   */
  const handleVenueSelect = (venue) => {
    setSelectedVenue(venue);
  };

  /**
   * Close venue panel
   */
  const handleClosePanel = () => {
    setSelectedVenue(null);
  };

  /**
   * Handle venue update (after status change)
   */
  const handleVenueUpdate = (updatedVenue) => {
    if (updatedVenue?.name) {
      const normalizedTarget = normalizeName(updatedVenue.name);
      setVenues((prev) =>
        prev.map((venue) =>
          normalizeName(venue.name) === normalizedTarget
            ? { ...venue, ...updatedVenue }
            : venue
        )
      );
      setSelectedVenue((prev) =>
        normalizeName(prev?.name) === normalizedTarget ? { ...prev, ...updatedVenue } : prev
      );
    }

    // Trigger immediate poll to get latest data
    if (pollingServiceRef.current) {
      pollingServiceRef.current.pollNow();
    }
  };

  const normalizedQuery = venueQuery.trim().toLowerCase();
  const filteredVenues = normalizedQuery
    ? venues.filter((venue) =>
        venue.name.toLowerCase().includes(normalizedQuery)
      )
    : venues;

  return (
    <div className="app">
      <div className="app-header">
        <h1 className="app-title">IBÁ Sales Venue Tracker</h1>
        <div className="app-status">
          {loading && <span className="status-loading">Loading...</span>}
          {error && <span className="status-error">{error}</span>}
          {lastSync && !loading && (
            <span className="status-sync">
              Last sync: {new Date(lastSync).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="app-content">
        <div className="app-map-container">
          <MapViewer
            venues={venues}
            onVenueClick={handlePlacemarkClick}
          />
        </div>

        {selectedVenue && (
          <VenuePanel
            venue={selectedVenue}
            onClose={handleClosePanel}
            onUpdate={handleVenueUpdate}
          />
        )}
      </div>

      {/* Venue list overlay for selection */}
      {venues.length > 0 && (
        <div className="app-venue-list">
          <details>
            <summary>Select Venue</summary>
            <input
              type="text"
              className="venue-search-input"
              placeholder="Search venues..."
              value={venueQuery}
              onChange={(event) => setVenueQuery(event.target.value)}
            />
            <ul>
              {filteredVenues.map((venue) => (
                <li key={venue.name}>
                  <button
                    onClick={() => handleVenueSelect(venue)}
                    className={`venue-list-item ${venue.visited ? 'visited' : 'not-visited'}`}
                  >
                    {venue.name} - {venue.visited ? '✓' : '○'}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

export default App;
