# API Documentation

API endpoints for the Sheets-Maps Sync Dashboard.

## Base URL

The base URL depends on your Cloud Functions deployment:
```
https://your-region-your-project.cloudfunctions.net/syncHandler
```

## Endpoints

### Health Check

Check if the API is running.

**Request**:
```
GET /api/health
```

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

---

### Get All Venues

Retrieve all venues with current status from Google Sheets (source of truth).

**Request**:
```
GET /api/venues
```

**Response**:
```json
{
  "success": true,
  "venues": [
    {
      "name": "Venue Name",
      "address": "123 Main St",
      "latitude": "40.7128",
      "longitude": "-74.0060",
      "clusterId": "Cluster-1",
      "assignedRep": "John Doe",
      "visited": true
    }
  ],
  "count": 1,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

**Notes**:
- This endpoint is called by the frontend polling service every 60 seconds
- Data comes directly from Google Sheets (source of truth)
- Latitude and longitude are optional

---

### Update Visited Status

Update the visited status for a specific venue.

**Request**:
```
POST /api/venues/{venueName}/visited
Content-Type: application/json

{
  "visited": true
}
```

**Parameters**:
- `venueName` (URL path): Name of the venue (URL-encoded)

**Body**:
- `visited` (boolean): `true` for visited, `false` for not visited

**Response**:
```json
{
  "success": true,
  "venue": {
    "name": "Venue Name",
    "address": "123 Main St",
    "latitude": "40.7128",
    "longitude": "-74.0060",
    "clusterId": "Cluster-1",
    "assignedRep": "John Doe",
    "visited": true
  }
}
```

**Notes**:
- Updates Google Sheets immediately (source of truth)
- Attempts to update My Maps (may be delayed - eventual consistency)
- Returns the updated venue object

---

### Trigger Manual Sync

Manually trigger a sync from Sheets to My Maps.

**Request**:
```
GET /api/sync
```

**Response**:
```json
{
  "success": true,
  "synced": 150,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

**Notes**:
- Syncs all venues from Sheets to My Maps
- My Maps updates may be delayed (eventual consistency)
- Returns count of synced venues

---

## Error Responses

All endpoints may return error responses:

**400 Bad Request**:
```json
{
  "error": "visited must be a boolean"
}
```

**404 Not Found**:
```json
{
  "error": "Not found"
}
```

**500 Internal Server Error**:
```json
{
  "error": "Failed to read venues from Google Sheets: ..."
}
```

## Authentication

The API uses OAuth tokens stored in Google Cloud Secret Manager. These are configured once by an admin using the `setup-auth.js` script.

No authentication is required for API calls (function is deployed with `--allow-unauthenticated`). Security is handled via:
- OAuth tokens stored in Secret Manager
- CORS restrictions (configured in function)
- Google API access controls

## Rate Limiting

- No explicit rate limiting implemented
- Google API quotas apply (check your project quotas)
- Polling interval: 60 seconds (configurable)

## Data Flow

1. **Source of Truth**: Google Sheets
2. **Visualization**: Google My Maps (derived from Sheets)
3. **Sync Direction**: Sheets → My Maps (one-way)
4. **Update Flow**:
   - User toggles status → Updates Sheets → Attempts My Maps update
   - Polling reads Sheets → Syncs to My Maps

## Notes on My Maps Updates

- My Maps updates may be delayed (eventual consistency)
- The system is designed to tolerate update delays
- If My Maps update fails, Sheets update still succeeds (Sheets is source of truth)
