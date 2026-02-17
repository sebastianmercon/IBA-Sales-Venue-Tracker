import React, { useState, useEffect, useCallback, useMemo } from 'react';
import MapViewer from './components/MapViewer';
import VenuePanel from './components/VenuePanel';
import PollingService from './services/polling';
import { createProspect, enrichProspect, getClusterPolygons, getVenues, updateProspect } from './services/api';
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

const VIRTUAL_ROW_HEIGHT = 60;
const VIRTUAL_OVERSCAN = 6;

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
  const normalizeName = useCallback((value) => String(value || '').trim().toLowerCase(), []);
  const [cachedCoordinates, setCachedCoordinates] = useState(() => {
    try {
      const raw = localStorage.getItem('svt_cached_coordinates');
      const parsed = raw ? JSON.parse(raw) : {};
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch (error) {
      return {};
    }
  });
  const [prospectVisitedOverrides, setProspectVisitedOverrides] = useState(() => {
    try {
      const raw = localStorage.getItem('svt_prospect_visited_overrides');
      const parsed = raw ? JSON.parse(raw) : {};
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch (error) {
      return {};
    }
  });
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
  const [addMode, setAddMode] = useState(false);
  const [showNativePoi, setShowNativePoi] = useState(false);
  const [prospectFormOpen, setProspectFormOpen] = useState(false);
  const [prospectFormLoading, setProspectFormLoading] = useState(false);
  const [prospectFormError, setProspectFormError] = useState(null);
  const [prospectDraft, setProspectDraft] = useState({
    name: '',
    address: '',
    notes: '',
    latitude: null,
    longitude: null,
  });
  const [enrichmentSuggestions, setEnrichmentSuggestions] = useState([]);
  const [venueListScrollTop, setVenueListScrollTop] = useState(0);
  const [venueListViewportHeight, setVenueListViewportHeight] = useState(300);
  const pollingServiceRef = React.useRef(null);
  const venueDetailsRef = React.useRef(null);
  const venueListScrollRef = React.useRef(null);
  const applyCachedCoordinates = useCallback(
    (venue) => {
      if (!venue?.name) {
        return venue;
      }
      const key = normalizeName(venue.name);
      const hasValidLatitude = Number.isFinite(Number.parseFloat(venue.latitude));
      const hasValidLongitude = Number.isFinite(Number.parseFloat(venue.longitude));
      const cached = cachedCoordinates[key];
      const withCoordinates = (hasValidLatitude && hasValidLongitude) || !cached
        ? venue
        : {
            ...venue,
            latitude: cached.latitude,
            longitude: cached.longitude,
          };
      if (withCoordinates.recordType === 'prospect' && typeof prospectVisitedOverrides[key] === 'boolean') {
        return {
          ...withCoordinates,
          visited: prospectVisitedOverrides[key],
        };
      }
      return withCoordinates;
    },
    [cachedCoordinates, normalizeName, prospectVisitedOverrides]
  );

  const mapVenuesWithCachedCoordinates = useCallback(
    (inputVenues) => (Array.isArray(inputVenues) ? inputVenues.map(applyCachedCoordinates) : []),
    [applyCachedCoordinates]
  );

  useEffect(() => {
    localStorage.setItem('svt_cached_coordinates', JSON.stringify(cachedCoordinates));
  }, [cachedCoordinates]);

  useEffect(() => {
    localStorage.setItem('svt_prospect_visited_overrides', JSON.stringify(prospectVisitedOverrides));
  }, [prospectVisitedOverrides]);

  useEffect(() => {
    localStorage.setItem('svt_hide_start_menu', showStartMenu ? 'false' : 'true');
  }, [showStartMenu]);

  // Load venues + clusters in parallel on mount, then start polling.
  useEffect(() => {
    let canceled = false;
    const pollingInterval = 60000; // 60 seconds

    pollingServiceRef.current = new PollingService(
      (updatedVenues, timestamp) => {
        setVenues(mapVenuesWithCachedCoordinates(updatedVenues));
        setLastSync(timestamp || new Date().toISOString());
        setError(null);
      },
      pollingInterval
    );

    // Fetch both endpoints in parallel for faster initial load.
    const loadInitial = async () => {
      setLoading(true);
      setError(null);
      try {
        const [venueData, clusterData] = await Promise.all([
          getVenues().catch((err) => {
            console.error('Error loading venues:', err);
            return null;
          }),
          getClusterPolygons().catch((err) => {
            console.warn('Failed to load cluster polygons:', err?.message || err);
            return null;
          }),
        ]);
        if (canceled) return;
        if (venueData) {
          setVenues(mapVenuesWithCachedCoordinates(venueData.venues || []));
          setLastSync(venueData.timestamp || new Date().toISOString());
        } else {
          setError('Failed to load venues. Please check your connection.');
        }
        if (clusterData) {
          setClusterPolygons(clusterData.polygons || []);
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    loadInitial();

    // Start polling AFTER initial load completes (avoids a duplicate fetch).
    // The polling service's first interval tick is after pollingInterval ms.
    pollingServiceRef.current.isPolling = true;
    pollingServiceRef.current.pollingId = setInterval(() => {
      pollingServiceRef.current.poll();
    }, pollingInterval);

    return () => {
      canceled = true;
      if (pollingServiceRef.current) {
        pollingServiceRef.current.stop();
      }
    };
  }, [mapVenuesWithCachedCoordinates]);

  /**
   * Load venues from API (manual refresh)
   */
  const loadVenues = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getVenues();
      setVenues(mapVenuesWithCachedCoordinates(data.venues || []));
      setLastSync(data.timestamp || new Date().toISOString());
    } catch (err) {
      console.error('Error loading venues:', err);
      setError('Failed to load venues. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, [mapVenuesWithCachedCoordinates]);

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

  const handleMapAddPoint = useCallback(({ lat, lng }) => {
    setProspectDraft((prev) => ({
      ...prev,
      latitude: lat,
      longitude: lng,
    }));
    setProspectFormError(null);
    setEnrichmentSuggestions([]);
    setProspectFormOpen(true);
  }, []);

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

  const handleProspectSave = async (event) => {
    event.preventDefault();
    if (!prospectDraft.name.trim()) {
      setProspectFormError('Venue name is required.');
      return;
    }
    setProspectFormLoading(true);
    setProspectFormError(null);
    try {
      await createProspect(prospectDraft);
      if (Number.isFinite(prospectDraft.latitude) && Number.isFinite(prospectDraft.longitude)) {
        const key = normalizeName(prospectDraft.name);
        setCachedCoordinates((prev) => ({
          ...prev,
          [key]: {
            latitude: prospectDraft.latitude,
            longitude: prospectDraft.longitude,
          },
        }));
      }
      setProspectFormOpen(false);
      setProspectDraft({
        name: '',
        address: '',
        notes: '',
        latitude: null,
        longitude: null,
      });
      await loadVenues();
      if (pollingServiceRef.current) {
        pollingServiceRef.current.pollNow();
      }
    } catch (err) {
      setProspectFormError('Failed to save prospect. Please try again.');
    } finally {
      setProspectFormLoading(false);
    }
  };

  const handleRunEnrichment = async () => {
    if (!prospectDraft.name.trim()) {
      setProspectFormError('Add a venue name before enrichment.');
      return;
    }
    setProspectFormLoading(true);
    setProspectFormError(null);
    try {
      const result = await enrichProspect(
        prospectDraft.name,
        prospectDraft.latitude,
        prospectDraft.longitude
      );
      const suggestions = result?.suggestions || [];
      setEnrichmentSuggestions(suggestions);
      if (suggestions.length > 0) {
        const top = suggestions[0];
        setProspectDraft((prev) => ({
          ...prev,
          name: top.venueName || prev.name,
          address: top.address || prev.address,
          notes: [
            prev.notes,
            top.contactPhone ? `Phone: ${top.contactPhone}` : '',
            top.website ? `Website: ${top.website}` : '',
          ]
            .filter(Boolean)
            .join('\n')
            .trim(),
          latitude: Number.isFinite(top.latitude) ? top.latitude : prev.latitude,
          longitude: Number.isFinite(top.longitude) ? top.longitude : prev.longitude,
        }));
      }
    } catch (err) {
      setProspectFormError('Enrichment failed. You can still save manually.');
    } finally {
      setProspectFormLoading(false);
    }
  };

  const handleProspectPanelUpdate = async (identifier, payload) => {
    const nextPayload = { ...payload };
    if ('visited' in nextPayload) {
      const key = normalizeName(identifier);
      const nextVisited = Boolean(nextPayload.visited);
      setProspectVisitedOverrides((prev) => ({
        ...prev,
        [key]: nextVisited,
      }));
      setVenues((prev) =>
        prev.map((venue) =>
          normalizeName(venue.name) === key ? { ...venue, visited: nextVisited } : venue
        )
      );
      setSelectedVenue((prev) =>
        normalizeName(prev?.name) === key ? { ...prev, visited: nextVisited } : prev
      );
      delete nextPayload.visited;
    }
    if (Object.keys(nextPayload).length > 0) {
      await updateProspect(identifier, nextPayload);
      await loadVenues();
    }
    if (selectedVenue?.name === identifier) {
      setSelectedVenue((prev) => ({ ...prev, ...payload }));
    }
  };

  const handleCoordinateResolved = useCallback(
    (venueName, lat, lng) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !venueName) {
        return;
      }
      const key = normalizeName(venueName);
      setCachedCoordinates((prev) => {
        const existing = prev[key];
        if (existing && Number(existing.latitude) === lat && Number(existing.longitude) === lng) {
          return prev;
        }
        return {
          ...prev,
          [key]: {
            latitude: lat,
            longitude: lng,
          },
        };
      });
      setVenues((prev) =>
        prev.map((venue) =>
          normalizeName(venue.name) === key
            ? { ...venue, latitude: lat, longitude: lng }
            : venue
        )
      );
    },
    [normalizeName]
  );

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

  const virtualRange = useMemo(() => {
    const total = filteredVenues.length;
    const start = Math.max(0, Math.floor(venueListScrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const end = Math.min(
      total,
      Math.ceil((venueListScrollTop + venueListViewportHeight) / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN
    );
    return { start, end, total };
  }, [filteredVenues.length, venueListScrollTop, venueListViewportHeight]);

  const virtualVenues = useMemo(
    () => filteredVenues.slice(virtualRange.start, virtualRange.end),
    [filteredVenues, virtualRange.start, virtualRange.end]
  );

  const topSpacerHeight = virtualRange.start * VIRTUAL_ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(
    0,
    (virtualRange.total - virtualRange.end) * VIRTUAL_ROW_HEIGHT
  );

  useEffect(() => {
    setVenueListScrollTop(0);
    if (venueListScrollRef.current) {
      venueListScrollRef.current.scrollTop = 0;
      setVenueListViewportHeight(venueListScrollRef.current.clientHeight || 300);
    }
  }, [venueQuery, showOnlyUnvisited, priorityFilter, premiseFilter]);

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
            className={`app-header-btn ${addMode ? 'app-header-btn--active' : ''}`}
            type="button"
            onClick={() => setAddMode((prev) => !prev)}
          >
            + Add Venue
          </button>
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
            addMode={addMode}
            onToggleAddMode={setAddMode}
            onMapAddPoint={handleMapAddPoint}
            showNativePoi={showNativePoi}
            onToggleNativePoi={setShowNativePoi}
            onVenueCoordinateResolved={handleCoordinateResolved}
          />
        </div>

        {selectedVenue && (
          <VenuePanel
            venue={selectedVenue}
            onClose={handleClosePanel}
            onUpdate={handleVenueUpdate}
            onProspectUpdate={handleProspectPanelUpdate}
          />
        )}
      </div>

      {prospectFormOpen && (
        <div className="prospect-modal-backdrop">
          <form className="prospect-modal-card" onSubmit={handleProspectSave}>
            <h3>Add Prospect Venue</h3>
            <p>Accounts tab fields: Venue Name, Address, Notes / Contact.</p>
            <div className="prospect-modal-grid">
              <input
                type="text"
                placeholder="Venue name"
                value={prospectDraft.name}
                onChange={(e) => setProspectDraft((prev) => ({ ...prev, name: e.target.value }))}
              />
              <input
                type="text"
                placeholder="Address"
                value={prospectDraft.address}
                onChange={(e) => setProspectDraft((prev) => ({ ...prev, address: e.target.value }))}
              />
              <textarea
                placeholder="Notes / Contact info"
                value={prospectDraft.notes}
                onChange={(e) => setProspectDraft((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
            {enrichmentSuggestions.length > 0 && (
              <div className="prospect-enrichment-hint">
                Suggestion: {enrichmentSuggestions[0].venueName} - {enrichmentSuggestions[0].address}
              </div>
            )}
            {prospectFormError && <div className="prospect-form-error">{prospectFormError}</div>}
            <div className="prospect-modal-actions">
              <button type="button" onClick={handleRunEnrichment} disabled={prospectFormLoading}>
                Auto-fill
              </button>
              <button type="button" onClick={() => setProspectFormOpen(false)} disabled={prospectFormLoading}>
                Cancel
              </button>
              <button type="submit" disabled={prospectFormLoading}>
                Save Prospect
              </button>
            </div>
          </form>
        </div>
      )}

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
            <div
              className="venue-list-virtual-scroll"
              ref={venueListScrollRef}
              onScroll={(event) => {
                setVenueListScrollTop(event.currentTarget.scrollTop);
                setVenueListViewportHeight(event.currentTarget.clientHeight || 300);
              }}
            >
              <div style={{ height: `${topSpacerHeight}px` }} />
              <ul className="venue-list-virtual-items">
              {virtualVenues.map((venue) => {
                const clusterColor = getClusterColor(venue.clusterId);
                const premiseVal = normalizePremiseValue(venue.premiseType);
                const venueItemKey = `${venue.recordType || 'active'}:${venue.name || ''}:${venue.address || ''}`;
                return (
                  <li key={venueItemKey}>
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
              <div style={{ height: `${bottomSpacerHeight}px` }} />
            </div>
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
