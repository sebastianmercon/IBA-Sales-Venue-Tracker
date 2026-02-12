import React, { useState } from 'react';
import StatusToggle from './StatusToggle';
import { updateVisitedStatus } from '../services/api';
import './VenuePanel.css';

/**
 * Venue Panel Component
 * Side panel displaying venue details and status toggle
 */
function VenuePanel({ venue, onClose, onUpdate }) {
  const [visited, setVisited] = useState(venue?.visited || false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const premiseDisplay = (() => {
    const raw = String(venue?.premiseType || '').trim().toLowerCase().replace(/[-_\s]/g, '');
    if (raw.startsWith('on')) return 'On-Premise';
    if (raw.startsWith('off')) return 'Off-Premise';
    if (raw) return venue.premiseType;
    return null;
  })();

  const clusterDisplay = (() => {
    const raw = String(venue?.clusterId || '').trim();
    if (!raw) {
      return 'N/A';
    }
    const lowered = raw.toLowerCase();
    if (lowered.startsWith('cluster')) {
      return raw;
    }
    return `Cluster ${raw}`;
  })();

  // Update local state when venue changes
  React.useEffect(() => {
    if (venue) {
      setVisited(venue.visited || false);
      setError(null);
    }
  }, [venue]);

  const handleToggle = async (newVisited) => {
    if (!venue) return;

    setLoading(true);
    setError(null);

    try {
      // Optimistic UI update
      setVisited(newVisited);

      // Update via API
      const result = await updateVisitedStatus(venue.name, newVisited);

      // Notify parent to refresh data
      if (onUpdate) {
        const updatedVenue = result?.venue ? result.venue : { name: venue.name, visited: newVisited };
        onUpdate(updatedVenue);
      }
    } catch (err) {
      // Rollback on error
      setVisited(!newVisited);
      setError('Failed to update status. Please try again.');
      console.error('Error updating visited status:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!venue) {
    return null;
  }

  return (
    <div className="venue-panel">
      <div className="venue-panel-header">
        <h2 className="venue-panel-title">Venue Details</h2>
        <button className="venue-panel-close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </div>

      <div className="venue-panel-content">
        <div className="venue-panel-section">
          <label className="venue-panel-label">Venue Name</label>
          <div className="venue-panel-value">{venue.name}</div>
        </div>

        {(venue.contactName || venue.contactTitle || venue.contactPhone || venue.contactEmail) && (
          <div className="venue-panel-section">
            <label className="venue-panel-label">Contact</label>
            <div className="venue-panel-value">
              {[venue.contactName, venue.contactTitle].filter(Boolean).join(' • ')}
            </div>
            {(venue.contactPhone || venue.contactEmail) && (
              <div className="venue-panel-value">
                {[venue.contactPhone, venue.contactEmail].filter(Boolean).join(' • ')}
              </div>
            )}
          </div>
        )}

        {venue.notes && (
          <div className="venue-panel-section">
            <label className="venue-panel-label">Notes</label>
            <div className="venue-panel-value">{venue.notes}</div>
          </div>
        )}

        <div className="venue-panel-section venue-panel-status">
          <StatusToggle
            visited={visited}
            onToggle={handleToggle}
            disabled={loading}
          />
        </div>

        <div className="venue-panel-section">
          <label className="venue-panel-label">Address</label>
          <div className="venue-panel-value">{venue.address || 'N/A'}</div>
        </div>

        {venue.neighborhood && (
          <div className="venue-panel-section">
            <label className="venue-panel-label">Neighborhood</label>
            <div className="venue-panel-value">{venue.neighborhood}</div>
          </div>
        )}

        {(venue.timeWindow1Start || venue.timeWindow1End) && (
          <div className="venue-panel-section">
            <label className="venue-panel-label">Time Window 1</label>
            <div className="venue-panel-value">
              {[venue.timeWindow1Start, venue.timeWindow1End].filter(Boolean).join(' - ')}
            </div>
          </div>
        )}

        {(venue.timeWindow2Start || venue.timeWindow2End) && (
          <div className="venue-panel-section">
            <label className="venue-panel-label">Time Window 2</label>
            <div className="venue-panel-value">
              {[venue.timeWindow2Start, venue.timeWindow2End].filter(Boolean).join(' - ')}
            </div>
          </div>
        )}

        {venue.bestTimeToVisit && (
          <div className="venue-panel-section">
            <label className="venue-panel-label">Best Time to Visit</label>
            <div className="venue-panel-value">{venue.bestTimeToVisit}</div>
          </div>
        )}

        {venue.bestDaysToVisit && (
          <div className="venue-panel-section">
            <label className="venue-panel-label">Best Days to Visit</label>
            <div className="venue-panel-value">{venue.bestDaysToVisit}</div>
          </div>
        )}

        <div className="venue-panel-section">
          <label className="venue-panel-label">Cluster Number</label>
          <div className="venue-panel-value">{clusterDisplay}</div>
        </div>

        {premiseDisplay && (
          <div className="venue-panel-section">
            <label className="venue-panel-label">Premise Type</label>
            <div className="venue-panel-value venue-panel-premise">
              <span
                className={`premise-badge ${premiseDisplay === 'On-Premise' ? 'premise-on' : 'premise-off'}`}
              >
                {premiseDisplay}
              </span>
            </div>
          </div>
        )}

        {venue.assignedRep && (
          <div className="venue-panel-section">
            <label className="venue-panel-label">Assigned Rep</label>
            <div className="venue-panel-value">{venue.assignedRep}</div>
          </div>
        )}

        {error && (
          <div className="venue-panel-error">{error}</div>
        )}

        {loading && (
          <div className="venue-panel-loading">Updating...</div>
        )}
      </div>
    </div>
  );
}

export default VenuePanel;
