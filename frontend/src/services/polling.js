/**
 * Polling service for syncing venue data
 * 
 * Design Decision: Poll every 120 seconds (configurable)
 * Immediate UI updates after user actions, full consistency via polling
 */

import { getVenues } from './api';

const DEFAULT_POLLING_INTERVAL = 120000; // 120 seconds

class PollingService {
  constructor(onUpdate, interval = DEFAULT_POLLING_INTERVAL) {
    this.onUpdate = onUpdate;
    this.interval = interval;
    this.pollingId = null;
    this.isPolling = false;
  }

  /**
   * Start polling
   */
  start() {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    
    // Poll immediately
    this.poll();

    // Then poll at intervals
    this.pollingId = setInterval(() => {
      this.poll();
    }, this.interval);
  }

  /**
   * Stop polling
   */
  stop() {
    if (this.pollingId) {
      clearInterval(this.pollingId);
      this.pollingId = null;
    }
    this.isPolling = false;
  }

  /**
   * Perform a single poll
   */
  async poll() {
    try {
      const data = await getVenues();
      if (this.onUpdate) {
        this.onUpdate(data.venues || [], data.timestamp);
      }
    } catch (error) {
      console.error('Polling error:', error);
      // Continue polling even on error
    }
  }

  /**
   * Manually trigger a poll
   */
  async pollNow() {
    await this.poll();
  }
}

export default PollingService;
