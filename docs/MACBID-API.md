# Mac.bid API Reference

[← Back to Project](./PROJECT.md)

All endpoints discovered by intercepting network traffic from the mac.bid frontend. These are undocumented internal APIs — they may change without notice.

## Base URL

| Service | Base URL |
|---------|----------|
| REST API | `https://api.macdiscount.com` |

## Authentication

### Public Endpoints (no auth required)

All read-only auction/location/building endpoints are public. No headers, tokens, or cookies needed. This tool only uses public endpoints.

## Endpoints Used by This Tool

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

**Use case:** Fetching product data and current bid/open status.

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

### SSR Data — GET https://www.mac.bid/lot/:lotId

**Public.** Fetches the lot detail page HTML and extracts the `__NEXT_DATA__` JSON payload embedded in the server-side rendered page. This provides richer product data than the DDB endpoint, including multiple product images.

**Use case:** Extracting product image URLs for LLM image analysis, and supplementary metadata not available from the DDB endpoint.

## Endpoints NOT Used

| Endpoint | Why not |
|----------|---------|
| `GET /locations` | Location-to-building mapping can be derived from `/buildings` data. |
| `GET /auctions` | Returns all active auctions (~1.2MB). Too broad; we fetch specific items. |
| `POST /multi_search` (Typesense) | Search not needed — entry points are specific URLs. |
| `GET /turbo-clock-auctions` | Turbo auctions handled via lot ID lookup. |
| `GET /firebase-token` | For real-time bid updates via Firebase. We poll DynamoDB instead. |
| `GET /user/me` | Watchlist access (requires Firebase auth). No longer used. |

## Rate Limiting

No explicit rate limiting observed. Recommended practices:
- Per-item DynamoDB lookups are lightweight
- `/buildings` can be cached for hours (rarely changes)
- Use exponential backoff on failures

## Fragility Assessment

| Component | Risk | Mitigation |
|-----------|------|------------|
| REST API paths | Medium — undocumented, could change | Validate expected fields, fail gracefully |
| Response shapes | Medium — fields could be renamed/removed | Validate expected fields, fail gracefully per item |
| DynamoDB lot endpoint | Low — core to their bidding system | Unlikely to change without breaking their own frontend |
