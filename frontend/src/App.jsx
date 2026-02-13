import React, { useState, useEffect, useCallback } from 'react';
import MapViewer from './components/MapViewer';
import VenuePanel from './components/VenuePanel';
import PollingService from './services/polling';
import { getClusterPolygons, getVenues } from './services/api';
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
  const [selectedVenueFocusNonce, setSelectedVenueFocusNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [venueQuery, setVenueQuery] = useState('');
  const [showOnlyUnvisited, setShowOnlyUnvisited] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [showStartMenu, setShowStartMenu] = useState(
    () => localStorage.getItem('svt_hide_start_menu') !== 'true'
  );
  const [clusterPolygons, setClusterPolygons] = useState([]);
  const pollingServiceRef = React.useRef(null);
  const venueDetailsRef = React.useRef(null);
  const normalizeName = useCallback((value) => String(value || '').trim().toLowerCase(), []);

  useEffect(() => {
    localStorage.setItem('svt_hide_start_menu', showStartMenu ? 'false' : 'true');
  }, [showStartMenu]);

  useEffect(() => {
    let canceled = false;
    getClusterPolygons()
      .then((data) => {
        if (!canceled) {
          setClusterPolygons(data.polygons || []);
        }
      })
      .catch((error) => {
        console.warn('Failed to load cluster polygons:', error?.message || error);
      });
    return () => {
      canceled = true;
    };
  }, []);

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
      setSelectedVenue({ ...venue });
      setSelectedVenueFocusNonce((prev) => prev + 1);
    }
  }, [venues, normalizeName]);

  /**
   * Handle manual venue selection (for testing or future features)
   */
  const handleVenueSelect = (venue) => {
    setSelectedVenue({ ...venue });
    setSelectedVenueFocusNonce((prev) => prev + 1);
    if (venueDetailsRef.current) {
      venueDetailsRef.current.open = false;
    }
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
  const visibleVenues = showOnlyUnvisited
    ? venues.filter((venue) => !venue.visited)
    : venues;
  const getPriorityLevel = (tagValue) => {
    const tag = String(tagValue || '').toLowerCase().trim();
    if (!tag) {
      return null;
    }
    if (/\b1\b/.test(tag) || tag.includes('one')) {
      return 1;
    }
    if (/\b2\b/.test(tag) || tag.includes('two')) {
      return 2;
    }
    if (/\b3\b/.test(tag) || tag.includes('three')) {
      return 3;
    }
    return null;
  };

  const priorityFilteredVenues = visibleVenues.filter((venue) => {
    const level = getPriorityLevel(venue.priorityTag);
    if (priorityFilter === 'all') {
      return true;
    }
    if (!level) {
      return false;
    }
    if (priorityFilter === 'priority12') {
      return level === 1 || level === 2;
    }
    if (priorityFilter === 'priority3') {
      return level === 3;
    }
    return true;
  });

  const filteredVenues = normalizedQuery
    ? priorityFilteredVenues.filter((venue) =>
        venue.name.toLowerCase().includes(normalizedQuery)
      )
    : priorityFilteredVenues;
  const visitedCount = venues.filter((venue) => venue.visited).length;
  const remainingCount = Math.max(venues.length - visitedCount, 0);

  return (
    <div className="app">
      {showStartMenu && (
        <div className="start-menu-backdrop">
          <div className="start-menu-card">
            <div className="start-menu-header">
              <div>
                <p className="start-menu-eyebrow">SalesVenueTracker</p>
                <h2 className="start-menu-title">Welcome back</h2>
                <p className="start-menu-subtitle">
                  Track visits, update statuses, and keep the team aligned with a clean view of venues.
                </p>
              </div>
              <button
                className="start-menu-close"
                type="button"
                onClick={() => setShowStartMenu(false)}
                aria-label="Close start menu"
              >
                ✕
              </button>
            </div>

            <div className="start-menu-stats">
              <div>
                <p className="start-menu-stat-label">Total venues</p>
                <p className="start-menu-stat-value">{venues.length}</p>
              </div>
              <div>
                <p className="start-menu-stat-label">Visited</p>
                <p className="start-menu-stat-value">{visitedCount}</p>
              </div>
              <div>
                <p className="start-menu-stat-label">Remaining</p>
                <p className="start-menu-stat-value">{remainingCount}</p>
              </div>
            </div>
            {lastSync && (
              <p className="start-menu-sync">
                Last sync: {new Date(lastSync).toLocaleTimeString()}
              </p>
            )}

            <div className="start-menu-actions">
              <button
                className="start-menu-primary"
                type="button"
                onClick={() => setShowStartMenu(false)}
              >
                Enter dashboard
              </button>
              <button
                className="start-menu-secondary"
                type="button"
                onClick={loadVenues}
              >
                Refresh venues
              </button>
            </div>

            <div className="start-menu-help">
              <p className="start-menu-help-title">Quick tips</p>
              <ul>
                <li>Use the search box to jump to a venue fast.</li>
                <li>Tap a marker or pick a venue to update visited status.</li>
                <li>The map clusters markers automatically for smoother performance.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="app-header">
        <h1 className="app-title">IBÁ Sales Venue Tracker</h1>
        <div className="app-status">
          {loading && <span className="status-loading">Loading...</span>}
          {error && <span className="status-error">{error}</span>}
          <button
            className={`app-filter-button ${showOnlyUnvisited ? 'active' : ''}`}
            type="button"
            onClick={() => setShowOnlyUnvisited((prev) => !prev)}
          >
            Show only unvisited
          </button>
          <button
            className={`app-filter-button ${priorityFilter === 'priority12' ? 'active' : ''}`}
            type="button"
            onClick={() =>
              setPriorityFilter((prev) => (prev === 'priority12' ? 'all' : 'priority12'))
            }
          >
            Priority 1-2
          </button>
          <button
            className={`app-filter-button ${priorityFilter === 'priority3' ? 'active' : ''}`}
            type="button"
            onClick={() =>
              setPriorityFilter((prev) => (prev === 'priority3' ? 'all' : 'priority3'))
            }
          >
            Priority 3
          </button>
          <button
            className="app-menu-button"
            type="button"
            onClick={() => setShowStartMenu(true)}
          >
            Menu
          </button>
        </div>
      </div>

      <div className="app-content">
        <div className="app-map-container">
          <MapViewer
            venues={priorityFilteredVenues}
            onVenueClick={handlePlacemarkClick}
            selectedVenue={selectedVenue}
            selectedVenueFocusNonce={selectedVenueFocusNonce}
            clusters={clusterPolygons}
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
          <details ref={venueDetailsRef}>
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
                    type="button"
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
