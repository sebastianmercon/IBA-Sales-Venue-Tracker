import React from 'react';
import './StatusToggle.css';

/**
 * Status Toggle Component
 * Toggle switch for visited status with visual feedback
 */
function StatusToggle({
  visited,
  onToggle,
  disabled = false,
  label = 'Visited:',
  visitedText = 'Yes',
  notVisitedText = 'No',
}) {
  const handleToggle = () => {
    if (!disabled) {
      onToggle(!visited);
    }
  };

  return (
    <div className="status-toggle-container">
      <label className="status-toggle-label">{label}</label>
      <button
        className={`status-toggle ${visited ? 'visited' : 'not-visited'} ${disabled ? 'disabled' : ''}`}
        onClick={handleToggle}
        disabled={disabled}
        aria-label={visited ? 'Mark as not visited' : 'Mark as visited'}
      >
        <span className="status-toggle-text">
          {visited ? visitedText : notVisitedText}
        </span>
      </button>
    </div>
  );
}

export default StatusToggle;
