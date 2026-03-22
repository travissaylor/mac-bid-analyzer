# Mac.bid API Reference

[← Back to Project](./PROJECT.md)

All endpoints discovered by intercepting network traffic from the mac.bid frontend. These are undocumented internal APIs — they may change without notice.

## Base URL

| Service | Base URL |
|---------|----------|
| REST API | `https://api.macdiscount.com` |

## Authentication

### Public Endpoints (no auth required)

All read-only auction/location/building endpoints are public. No headers, tokens, or cookies needed.

### Authenticated Endpoints (Firebase ID token required)

User-specific endpoints (watchlist, user profile) require a Firebase ID token passed as an `Authorization` header.

**Firebase project config:**
- API Key: `AIzaSyDjWLdT_94-6VCQWuRdNUrYI-50M_3XLPs`
- Auth method: Email/password sign-in

**Auth flow:**
1. Sign in via Firebase Auth REST API: `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={API_KEY}`
2. Request body: `{ "email": "...", "password": "...", "returnSecureToken": true }`
3. Response includes `idToken` (expires ~1 hour) and `refreshToken` (long-lived)
4. Pass `idToken` as `Authorization` header on authenticated requests
5. Refresh via: `POST https://securetoken.googleapis.com/v1/token?key={API_KEY}` with `{ "grant_type": "refresh_token", "refresh_token": "..." }`

## Endpoints Used by This Tool

### GET /user/me

**Auth required.** Returns the authenticated user's profile, including the full watchlist.

**Headers:**
```
Authorization: {firebase_id_token}
Content-Type: application/json
```

**Response includes:**
```json
{
  "user_id": 12345,
  "email": "user@example.com",
  "watchlist_full": [
    {
      "id": 52217488,
      "auction_id": 76563,
      "lot_number": "3194Q",
      "product_name": "TearPlex MacBook Pro Charger",
      "upc": "B08RYXFQDT",
      "condition_name": "OPEN BOX",
      "retail_price": 28.99,
      "category": "Computers",
      "image_url": "https://media.mac.bid/products/...",
      "expected_close_date": "2026-03-22T23:13:33.000Z",
      "is_open": 1,
      "is_transferrable": 1,
      "current_location_id": 24,
      "building_id": 14,
      "description": "...",
      "dimensions": "..."
    }
  ]
}
```

The combined user fetch also hits these in parallel (same auth):
- `GET /payments/{userId}/customer-purchase-summary`
- `GET /auctions/customer/{userId}/active-auctions`
- `GET /auctions/customer/{userId}/auction-alerts`

For this tool, we only need the basic `GET /user/me` call.

### GET /auctions/:id?getItems=1

**Public.** Returns a single auction with all its items.

**Key item fields:**
```json
{
  "id": 52112834,
  "auction_id": 76468,
  "expected_close_date": "2026-03-19T19:24:55.000Z",
  "lot_number": "2491P",
  "is_open": 1,
  "is_transferrable": 1,
  "total_bids": 0,
  "winning_bid_amount": null,
  "unique_bidders": 0,
  "title": "smiry Memory Foam Bath Mat",
  "product_name": "smiry Memory Foam Bath Mat",
  "upc": "B09JP9GFCC",
  "description": "...",
  "dimensions": "47\"L x 24\"W",
  "quantity": 1,
  "retail_price": 28.99,
  "condition_name": "OPEN BOX",
  "category": "Rugs",
  "image_url": "https://media.mac.bid/products/...",
  "current_location_id": 24,
  "building_id": 14
}
```

### GET /lot/:lotId

**Public.** Returns a single lot by its numeric ID.

```json
{
  "id": 52217488,
  "auction_id": 76563,
  "lot_number": "3194Q",
  "product_name": "...",
  "upc": "...",
  "condition_name": "OPEN BOX",
  "retail_price": 28.99,
  ...
}
```

### GET /map-bid/ddb/lot/:lotId

**Public.** Returns real-time bid data from DynamoDB.

```json
{
  "lot_id": 52217488,
  "auction_id": "76563",
  "location_id": "24",
  "title": "TearPlex MacBook Pro Charger",
  "is_open": true,
  "total_bids": "0",
  "current_bid": "0",
  "max_bid": "0",
  "winning_bidder_id": "",
  "end_time": "2026-03-22T23:13:33.000Z",
  "extension_window": "2026-03-22T23:11:33.000Z",
  "watchers_count": 2,
  "has_buyer_assurance": false,
  "stock_image_url": "https://media.mac.bid/products/..."
}
```

**Use case:** Updating current bid and open/closed status on each cron run.

### GET /buildings

**Public.** Returns all buildings with coordinates, tax rates, and transfer destinations.

```json
{
  "id": 15,
  "name": "Robinson",
  "city_state": "Pittsburgh, PA",
  "state_abbr": "PA",
  "latitude": 40.4567,
  "longitude": -80.1234,
  "transfer_destinations": "2,6,16",
  "box_sizes": "large, medium, small",
  "sales_tax": 0.06
}
```

**Use case:** Determining sales tax rate and deriving transfer-eligible buildings from home building IDs.

### GET /locations

**Public.** Returns all pickup locations.

```json
{
  "id": 1,
  "name": "Washington - A",
  "city_state": "Washington, PA",
  "building_id": 1,
  "can_transfer": 1,
  "transfer_destinations": "24,93"
}
```

**Use case:** Mapping `current_location_id` on items to building IDs for location cost calculation.

## Endpoints NOT Used

| Endpoint | Why not |
|----------|---------|
| `GET /auctions` | Returns all active auctions (~1.2MB). Too broad; we fetch specific items. |
| `POST /multi_search` (Typesense) | Search not needed — entry points are specific URLs or watchlist. |
| `GET /turbo-clock-auctions` | Turbo auctions may appear on watchlist; handled via lot ID lookup. |
| `GET /firebase-token` | For real-time bid updates via Firebase. We poll DynamoDB instead. |
| `POST /user/{id}/watchlist` | Adding to watchlist. Read-only for this tool. |
| `DELETE /user/{id}/watchlist/{lotId}` | Removing from watchlist. Read-only for this tool. |

## Rate Limiting

No explicit rate limiting observed. Recommended practices:
- Watchlist polling: every 30 minutes via cron
- Per-item DynamoDB lookups are lightweight
- `/buildings` can be cached for hours (rarely changes)
- Use exponential backoff on failures

## Fragility Assessment

| Component | Risk | Mitigation |
|-----------|------|------------|
| REST API paths | Medium — undocumented, could change | Circuit breaker alerts via Ntfy |
| Response shapes | Medium — fields could be renamed/removed | Validate expected fields, fail gracefully per item |
| Firebase auth | Low — Google-maintained service | Standard, well-documented auth flow |
| DynamoDB lot endpoint | Low — core to their bidding system | Unlikely to change without breaking their own frontend |
