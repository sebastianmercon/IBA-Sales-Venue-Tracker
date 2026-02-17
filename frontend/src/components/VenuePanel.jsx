import React, { useState } from 'react';
import { updateVisitedStatus } from '../services/api';
import './VenuePanel.css';

/**
 * Venue Panel Component
 * Side panel displaying venue details and status toggle
 */
function VenuePanel({ venue, onClose, onUpdate, onProspectUpdate }) {
  const [visited, setVisited] = useState(venue?.visited || false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState({
    address: venue?.address || '',
    notes: venue?.notes || '',
  });

  const premiseInfo = (() => {
    const raw = String(venue?.premiseType || '').trim().toLowerCase().replace(/[-_\s]/g, '');
    if (raw.startsWith('on')) return { label: 'On-Premise', tone: 'on' };
    if (raw.startsWith('off')) return { label: 'Off-Premise', tone: 'off' };
    if (raw) return { label: venue.premiseType, tone: 'neutral' };
    return { label: null, tone: 'neutral' };
  })();

  // Sky-phase cluster palette — dawn to midnight
  const CLUSTER_COLORS = [
    { bg: 'rgba(232,111,45,0.12)', text: '#b34a12', border: 'rgba(232,111,45,0.3)' },   // 1 dawn
    { bg: 'rgba(212,160,23,0.12)', text: '#92700e', border: 'rgba(212,160,23,0.3)' },   // 2 golden
    { bg: 'rgba(198,90,58,0.12)',  text: '#8b3a1e', border: 'rgba(198,90,58,0.3)' },    // 3 terracotta
    { bg: 'rgba(30,58,95,0.12)',   text: '#1E3A5F', border: 'rgba(30,58,95,0.3)' },     // 4 navy
    { bg: 'rgba(91,58,122,0.12)',  text: '#5B3A7A', border: 'rgba(91,58,122,0.3)' },    // 5 twilight
    { bg: 'rgba(42,107,94,0.12)',  text: '#1a5446', border: 'rgba(42,107,94,0.3)' },    // 6 night teal
    { bg: 'rgba(139,69,19,0.12)',  text: '#6b3410', border: 'rgba(139,69,19,0.3)' },    // 7 agave earth
  ];

  const clusterInfo = (() => {
    const raw = String(venue?.clusterId || '').trim();
    if (!raw) return { label: 'Cluster pending', number: null };
    const match = raw.match(/\d+/);
    const num = match ? parseInt(match[0], 10) : null;
    const label = raw.toLowerCase().startsWith('cluster') ? raw : `Cluster ${raw}`;
    return { label, number: num };
  })();

  const clusterStyle = clusterInfo.number
    ? CLUSTER_COLORS[(clusterInfo.number - 1) % CLUSTER_COLORS.length]
    : null;
  const hasContactInfo = Boolean(venue.contactName || venue.contactTitle || venue.contactPhone || venue.contactEmail);
  const hasBestTime = Boolean(String(venue.bestTimeToVisit || '').trim());
  const hasNotes = Boolean(String(venue.notes || '').trim());
  const mapQuery = encodeURIComponent(
    [venue?.name, venue?.address, venue?.neighborhood].filter(Boolean).join(' ')
  );
  const mapsUrl = mapQuery
    ? `https://www.google.com/maps/search/?api=1&query=${mapQuery}`
    : null;

  // Update local state when venue changes
  React.useEffect(() => {
    if (venue) {
      setVisited(venue.visited || false);
      setError(null);
      setEditingContact(false);
      setContactDraft({
        address: venue?.address || '',
        notes: venue?.notes || '',
      });
    }
  }, [venue]);

  const handleToggle = async (newVisited) => {
    if (!venue) return;

    setLoading(true);
    setError(null);

    try {
      // Optimistic UI update
      setVisited(newVisited);

      // Prospects are stored in Accounts (3 columns), so visited is persisted via prospect update.
      let result;
      if (isProspect && onProspectUpdate) {
        await onProspectUpdate(venue.name, { visited: newVisited });
        result = { venue: { name: venue.name, visited: newVisited } };
      } else {
        result = await updateVisitedStatus(venue.name, newVisited);
      }

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

  const isProspect = venue.recordType === 'prospect';

  const handleContactSave = async () => {
    if (!isProspect || !onProspectUpdate) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onProspectUpdate(venue.name, contactDraft);
      if (onUpdate) {
        onUpdate({ ...venue, ...contactDraft });
      }
      setEditingContact(false);
    } catch (err) {
      setError('Failed to update contact details.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`venue-panel venue-panel--tone-${premiseInfo.tone}`}>
      <div className="venue-panel-header">
        <h2 className="venue-panel-title">Venue Profile</h2>
        <button className="venue-panel-close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </div>
      <div className="venue-panel-hero">
        <span className="venue-panel-hero-kicker">Visit Playbook</span>
        <div className="venue-panel-hero-chip-row">
          {clusterStyle && (
            <span
              className="cluster-badge cluster-badge--hero"
              style={{
                background: clusterStyle.bg,
                color: clusterStyle.text,
                border: `1px solid ${clusterStyle.border}`,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <circle cx="6" cy="6" r="5" />
              </svg>
              {clusterInfo.label}
            </span>
          )}
          {premiseInfo.label && (
            <span className={`premise-badge premise-badge--hero ${premiseInfo.tone === 'on' ? 'premise-on' : 'premise-off'}`}>
              {premiseInfo.tone === 'on' ? (
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="4" y1="2.5" x2="4" y2="8.5" />
                  <line x1="6.2" y1="2.5" x2="6.2" y2="8.5" />
                  <line x1="8.4" y1="2.5" x2="8.4" y2="8.5" />
                  <line x1="6.2" y1="8.5" x2="6.2" y2="17" />
                  <path d="M14.5 2.5c0 3.8-.2 6.6-2.7 9.6" />
                  <line x1="11.8" y1="12.1" x2="11.8" y2="17" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="7" width="12" height="10" rx="1.5" />
                  <path d="M7 7V5a3 3 0 0 1 6 0v2" />
                </svg>
              )}
              {premiseInfo.label}
            </span>
          )}
        </div>
      </div>

      <div className="venue-panel-content">
        <section className="venue-panel-priority">
          <h3 className="venue-panel-group-title">At a Glance</h3>
          <div className="venue-panel-priority-grid">
            <div className="venue-panel-priority-item">
              <label className="venue-panel-label">Venue Name</label>
              <div className="venue-panel-value">{venue.name || 'N/A'}</div>
            </div>
            <div className="venue-panel-priority-item">
              <label className="venue-panel-label">Visit Status</label>
              <button
                type="button"
                className={`visit-status-toggle ${visited ? 'visit-status-toggle--visited' : 'visit-status-toggle--not-visited'}`}
                onClick={() => handleToggle(!visited)}
                disabled={loading}
                aria-label={visited ? 'Mark as not visited' : 'Mark as visited'}
              >
                {visited ? 'Visited' : 'Not Visited'}
              </button>
            </div>
            {hasContactInfo && (
              <div className="venue-panel-priority-item">
                <label className="venue-panel-label">Contact</label>
                <div className="venue-panel-value">
                  {[venue.contactName, venue.contactTitle].filter(Boolean).join(' • ') ||
                    [venue.contactPhone, venue.contactEmail].filter(Boolean).join(' • ')}
                </div>
              </div>
            )}
            {hasBestTime && (
              <div className="venue-panel-priority-item">
                <label className="venue-panel-label">Best Time to Visit</label>
                <div className="venue-panel-value">{venue.bestTimeToVisit}</div>
              </div>
            )}
            {hasNotes && (
              <div className="venue-panel-priority-item venue-panel-priority-item--full">
                <label className="venue-panel-label">Notes</label>
                <div className="venue-panel-value">{venue.notes}</div>
              </div>
            )}
          </div>
        </section>

        <section className="venue-panel-group">
          <h3 className="venue-panel-group-title">Visit Strategy</h3>

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

          <div className="venue-panel-section">
            <label className="venue-panel-label">Cluster</label>
            <div className="venue-panel-value">
              {clusterStyle ? (
                <span
                  className="cluster-badge"
                  style={{
                    background: clusterStyle.bg,
                    color: clusterStyle.text,
                    border: `1px solid ${clusterStyle.border}`,
                  }}
                >
                  {clusterInfo.label}
                </span>
              ) : (
                <span className="cluster-badge cluster-badge--na">{clusterInfo.label}</span>
              )}
            </div>
          </div>

          {premiseInfo.label && (
            <div className="venue-panel-section">
              <label className="venue-panel-label">Premise Type</label>
              <div className="venue-panel-value venue-panel-premise">
                <span
                  className={`premise-badge ${premiseInfo.tone === 'on' ? 'premise-on' : 'premise-off'}`}
                >
                  {premiseInfo.tone === 'on' ? (
                    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="4" y1="2.5" x2="4" y2="8.5" />
                      <line x1="6.2" y1="2.5" x2="6.2" y2="8.5" />
                      <line x1="8.4" y1="2.5" x2="8.4" y2="8.5" />
                      <line x1="6.2" y1="8.5" x2="6.2" y2="17" />
                      <path d="M14.5 2.5c0 3.8-.2 6.6-2.7 9.6" />
                      <line x1="11.8" y1="12.1" x2="11.8" y2="17" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="4" y="7" width="12" height="10" rx="1.5" />
                      <path d="M7 7V5a3 3 0 0 1 6 0v2" />
                    </svg>
                  )}
                  {premiseInfo.label}
                </span>
              </div>
            </div>
          )}

          {venue.bestDaysToVisit && (
            <div className="venue-panel-section">
              <label className="venue-panel-label">Best Days to Visit</label>
              <div className="venue-panel-value">{venue.bestDaysToVisit}</div>
            </div>
          )}
        </section>

        <section className="venue-panel-group">
          <h3 className="venue-panel-group-title">Venue</h3>
          <div className="venue-panel-section">
            <label className="venue-panel-label">Venue Name</label>
            <div className="venue-panel-value">{venue.name}</div>
          </div>

          {venue.neighborhood && (
            <div className="venue-panel-section">
              <label className="venue-panel-label">Neighborhood</label>
              <div className="venue-panel-value">{venue.neighborhood}</div>
            </div>
          )}

          <div className="venue-panel-section">
            <label className="venue-panel-label">Address</label>
            <div className="venue-address-card">
              <div className="venue-panel-value">{venue.address || 'N/A'}</div>
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="venue-address-link"
                >
                  Open in Maps
                </a>
              )}
            </div>
          </div>
        </section>

        {(venue.contactName || venue.contactTitle || venue.contactPhone || venue.contactEmail || isProspect) && (
          <section className="venue-panel-group">
            <h3 className="venue-panel-group-title">Relationship</h3>
            <div className="venue-panel-section">
              <label className="venue-panel-label">Contact</label>
              <div className="venue-panel-value">
                {[venue.contactName, venue.contactTitle].filter(Boolean).join(' • ') || 'N/A'}
              </div>
            </div>

            <div className="contact-links">
              {venue.contactPhone && (
                <a className="contact-link" href={`tel:${venue.contactPhone}`}>
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4.5 3h3l1.2 3.2-1.6 1.6c1 2.1 2.6 3.7 4.7 4.7l1.6-1.6L17.5 12v3c0 .8-.7 1.5-1.5 1.5A12 12 0 0 1 3 4.5C3 3.7 3.7 3 4.5 3z" />
                  </svg>
                  {venue.contactPhone}
                </a>
              )}
              {venue.contactEmail && (
                <a className="contact-link" href={`mailto:${venue.contactEmail}`}>
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2.8" y="4.5" width="14.4" height="11" rx="1.8" />
                    <path d="M3.5 5.5l6.5 5 6.5-5" />
                  </svg>
                  {venue.contactEmail}
                </a>
              )}
            </div>

            {venue.assignedRep && (
              <div className="venue-panel-section">
                <label className="venue-panel-label">Assigned Rep</label>
                <div className="venue-panel-value">{venue.assignedRep}</div>
              </div>
            )}

            {isProspect && (
              <div className="venue-panel-section">
                <div className="venue-panel-edit-actions">
                  {!editingContact ? (
                    <button type="button" className="venue-panel-edit-btn" onClick={() => setEditingContact(true)}>
                      Edit account notes/contact
                    </button>
                  ) : (
                    <>
                      <input
                        className="venue-panel-edit-input"
                        type="text"
                        placeholder="Address"
                        value={contactDraft.address}
                        onChange={(e) => setContactDraft((prev) => ({ ...prev, address: e.target.value }))}
                      />
                      <textarea
                        className="venue-panel-edit-input"
                        placeholder="Notes / Contact info"
                        value={contactDraft.notes}
                        onChange={(e) => setContactDraft((prev) => ({ ...prev, notes: e.target.value }))}
                      />
                      <div className="venue-panel-edit-actions-row">
                        <button type="button" className="venue-panel-edit-btn" onClick={handleContactSave}>
                          Save
                        </button>
                        <button type="button" className="venue-panel-edit-btn" onClick={() => setEditingContact(false)}>
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {hasNotes && (
          <div className="venue-panel-section">
            <label className="venue-panel-label">Notes</label>
            <div className="venue-notes-card">
              <div className="venue-panel-value">{venue.notes}</div>
            </div>
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
