/**
 * Simple in-memory cache with TTL for Cloud Function responses.
 *
 * Cloud Functions instances stay warm for minutes, so an in-memory cache
 * avoids hitting Google Sheets / My Maps KML on every single request.
 *
 * Write-through: mutations (visited toggle, coordinate update) invalidate
 * the venues cache so the next read is fresh.
 */

class MemoryCache {
  constructor() {
    this._store = new Map();
  }

  /**
   * Get a cached value if it exists and hasn't expired.
   * @param {string} key
   * @returns {*|undefined}
   */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Store a value with a TTL (in milliseconds).
   * @param {string} key
   * @param {*} value
   * @param {number} ttlMs
   */
  set(key, value, ttlMs) {
    this._store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Remove a specific key (used after mutations).
   * @param {string} key
   */
  invalidate(key) {
    this._store.delete(key);
  }
}

// Singleton shared across the Cloud Function instance lifetime.
const cache = new MemoryCache();

module.exports = { cache };
