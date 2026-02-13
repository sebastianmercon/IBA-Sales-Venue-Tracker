import React, { useState, useEffect, useCallback, useMemo } from 'react';
import MapViewer from './components/MapViewer';
import VenuePanel from './components/VenuePanel';
import PollingService from './services/polling';
import { getClusterPolygons, getVenues } from './services/api';
import './App.css';

// Sky-phase palette — inspired by the Oaxacan sky from dawn to midnight
const CLUSTER_COLORS = [
  '#E86F2D', // 1 dawn / sunrise orange
  '#D4A017', // 2 morning / golden hour
  '#C65A3A', // 3 midday / terracotta
  '#1E3A5F', // 4 dusk / deep navy
  '#5B3A7A', // 5 twilight / violet
  '#2A6B5E', // 6 night / deep teal
  '#8B4513', // 7 earth / agave brown
];

function getClusterColor(clusterId) {
  const raw = String(clusterId || '').trim();
  const match = raw.match(/\d+/);
  if (!match) return null;
  const num = parseInt(match[0], 10);
  return CLUSTER_COLORS[(num - 1) % CLUSTER_COLORS.length] || null;
}

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
  const [showFilters, setShowFilters] = useState(false);
  const [premiseFilter, setPremiseFilter] = useState('all');
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

  const normalizePremiseValue = (value) => {
    const v = String(value || '').toLowerCase().trim().replace(/[-_\s]/g, '');
    if (v.startsWith('on') || v === 'restaurant' || v === 'bar') return 'on';
    if (v.startsWith('off') || v === 'retail' || v === 'store' || v === 'shop') return 'off';
    return null;
  };

  const premiseFilteredVenues = priorityFilteredVenues.filter((venue) => {
    if (premiseFilter === 'all') return true;
    const premise = normalizePremiseValue(venue.premiseType);
    return premise === premiseFilter;
  });

  const filteredVenues = normalizedQuery
    ? premiseFilteredVenues.filter((venue) =>
        venue.name.toLowerCase().includes(normalizedQuery)
      )
    : premiseFilteredVenues;
  const visitedCount = venues.filter((venue) => venue.visited).length;
  const remainingCount = Math.max(venues.length - visitedCount, 0);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (showOnlyUnvisited) count++;
    if (priorityFilter !== 'all') count++;
    if (premiseFilter !== 'all') count++;
    return count;
  }, [showOnlyUnvisited, priorityFilter, premiseFilter]);

  return (
    <div className="app">
      {showStartMenu && (
        <div className="start-menu-backdrop">
          <div className="start-menu-card">
            <div className="start-menu-header">
              <div>
                <p className="start-menu-eyebrow">IBÁ Mezcal</p>
                <h2 className="start-menu-title">Celebrate the Journey</h2>
                <p className="start-menu-subtitle">
                  Track every venue, update visit statuses, and keep the team moving with purpose.
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
                <p className="start-menu-stat-label">Venues</p>
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
                Enter Dashboard
              </button>
              <button
                className="start-menu-secondary"
                type="button"
                onClick={loadVenues}
              >
                Sync Venues
              </button>
            </div>

            <div className="start-menu-help">
              <p className="start-menu-help-title">How it works</p>
              <ul>
                <li>Search or tap a marker to find a venue instantly.</li>
                <li>Update visit statuses in one tap — the sheet syncs automatically.</li>
                <li>Clusters dissolve as you zoom in, revealing individual venues.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="app-header">
        <div className="app-header-left">
          <h1 className="app-title">IBÁ</h1>
          <span className="app-title-sub">Sales Venue Tracker</span>
          {loading && <span className="status-loading">Syncing...</span>}
          {error && <span className="status-error">{error}</span>}
        </div>
        <div className="app-header-right">
          <button
            className={`app-header-btn ${showFilters ? 'app-header-btn--active' : ''}`}
            type="button"
            onClick={() => setShowFilters((prev) => !prev)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 2h13M3.5 6h9M5.5 10h5M7 14h2"/></svg>
            Filters
            {activeFilterCount > 0 && (
              <span className="filter-count-badge">{activeFilterCount}</span>
            )}
          </button>
          <button
            className="app-header-btn"
            type="button"
            onClick={() => setShowStartMenu(true)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></svg>
            Menu
          </button>
        </div>
        <div className="app-header-accent" />
      </div>

      {showFilters && (
        <div className="filters-drawer">
          <div className="filters-drawer-inner">
            <span className="filters-label">Filter by</span>
            <button
              className={`filter-chip ${showOnlyUnvisited ? 'filter-chip--active' : ''}`}
              type="button"
              onClick={() => setShowOnlyUnvisited((prev) => !prev)}
            >
              Unvisited only
            </button>
            <span className="filters-divider" />
            <button
              className={`filter-chip ${priorityFilter === 'priority12' ? 'filter-chip--active' : ''}`}
              type="button"
              onClick={() =>
                setPriorityFilter((prev) => (prev === 'priority12' ? 'all' : 'priority12'))
              }
            >
              Priority 1-2
            </button>
            <button
              className={`filter-chip ${priorityFilter === 'priority3' ? 'filter-chip--active' : ''}`}
              type="button"
              onClick={() =>
                setPriorityFilter((prev) => (prev === 'priority3' ? 'all' : 'priority3'))
              }
            >
              Priority 3
            </button>
            <span className="filters-divider" />
            <button
              className={`filter-chip ${premiseFilter === 'on' ? 'filter-chip--active' : ''}`}
              type="button"
              onClick={() =>
                setPremiseFilter((prev) => (prev === 'on' ? 'all' : 'on'))
              }
            >
              On-Premise
            </button>
            <button
              className={`filter-chip ${premiseFilter === 'off' ? 'filter-chip--active' : ''}`}
              type="button"
              onClick={() =>
                setPremiseFilter((prev) => (prev === 'off' ? 'all' : 'off'))
              }
            >
              Off-Premise
            </button>
            {(showOnlyUnvisited || priorityFilter !== 'all' || premiseFilter !== 'all') && (
              <button
                className="filter-chip filter-chip--clear"
                type="button"
                onClick={() => {
                  setShowOnlyUnvisited(false);
                  setPriorityFilter('all');
                  setPremiseFilter('all');
                }}
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      )}

      <div className="app-content">
        <div className="app-map-container">
          <MapViewer
            venues={premiseFilteredVenues}
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
            <summary>Find a Venue ({filteredVenues.length})</summary>
            <input
              type="text"
              className="venue-search-input"
              placeholder="Search by name..."
              value={venueQuery}
              onChange={(event) => setVenueQuery(event.target.value)}
            />
            <ul>
              {filteredVenues.map((venue) => {
                const clusterColor = getClusterColor(venue.clusterId);
                const premiseVal = normalizePremiseValue(venue.premiseType);
                return (
                  <li key={venue.name}>
                    <button
                      type="button"
                      onClick={() => handleVenueSelect(venue)}
                      className={`venue-card ${venue.visited ? 'venue-card--visited' : 'venue-card--unvisited'}`}
                    >
                      <span className="venue-card-status" aria-label={venue.visited ? 'Visited' : 'Not visited'} />
                      <span className="venue-card-body">
                        <span className="venue-card-name">{venue.name}</span>
                        <span className="venue-card-meta">
                          {venue.neighborhood && <span>{venue.neighborhood}</span>}
                          {premiseVal && (
                            <span className={`venue-card-premise venue-card-premise--${premiseVal}`}>
                              {premiseVal === 'on' ? 'On-Prem' : 'Off-Prem'}
                            </span>
                          )}
                        </span>
                      </span>
                      {clusterColor && (
                        <span className="venue-card-cluster" style={{ background: clusterColor }}>
                          {String(venue.clusterId).replace(/\D/g, '')}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="venue-list-close-wrap">
              <button
                type="button"
                className="venue-list-close"
                onClick={() => { if (venueDetailsRef.current) venueDetailsRef.current.open = false; }}
                aria-label="Close venue list"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 5.5L7 9l3.5-3.5"/></svg>
                Close
              </button>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

export default App;
