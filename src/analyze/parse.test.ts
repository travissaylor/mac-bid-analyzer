import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  parseLotId,
  isAsin,
  fetchLotItem,
  extractImageUrls,
} from "./parse";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

describe("parseLotId", () => {
  it("should parse a bare numeric lot ID", () => {
    expect(parseLotId("12345")).toBe(12345);
  });

  it("should parse a bare numeric lot ID with whitespace", () => {
    expect(parseLotId("  12345  ")).toBe(12345);
  });

  it("should parse /lot/{id} permalink", () => {
    expect(parseLotId("/lot/67890")).toBe(67890);
  });

  it("should parse full URL with auction and lot", () => {
    expect(parseLotId("https://mac.bid/auction/abc-123/lot/99999")).toBe(99999);
  });

  it("should parse full URL with www prefix", () => {
    expect(parseLotId("https://www.mac.bid/auction/abc-123/lot/55555")).toBe(55555);
  });

  it("should parse https://mac.bid/lot/{id}", () => {
    expect(parseLotId("https://mac.bid/lot/44444")).toBe(44444);
  });

  it("should return URL string for alphanumeric lot numbers", () => {
    const result = parseLotId("https://www.mac.bid/auction/UNL2603-23-A1/lot/2587T");
    expect(typeof result).toBe("string");
    expect(result).toContain("mac.bid");
  });

  it("should throw for invalid input", () => {
    expect(() => parseLotId("not-a-url")).toThrow("Cannot parse lot ID");
  });

  it("should throw for empty input", () => {
    expect(() => parseLotId("")).toThrow("Cannot parse lot ID");
  });
});

describe("isAsin", () => {
  it("should detect ASINs starting with B0", () => {
    expect(isAsin("B0ABCD1234")).toBe(true);
  });

  it("should not detect real UPCs as ASINs", () => {
    expect(isAsin("012345678901")).toBe(false);
  });

  it("should not detect short strings as ASINs", () => {
    expect(isAsin("B0ABC")).toBe(false);
  });

  it("should not detect non-B0 10-char strings as ASINs", () => {
    expect(isAsin("A0ABCD1234")).toBe(false);
  });
});

describe("fetchLotItem", () => {
  beforeEach(() => {
    restoreFetch();
  });

  afterEach(() => {
    restoreFetch();
  });

  it("should fetch and parse lot data", async () => {
    mockFetch(async (url) => {
      expect(url).toContain("/map-bid/ddb/lot/12345");
      return new Response(JSON.stringify({
        id: 12345,
        auction_id: 100,
        lot_number: "42",
        product_name: "Test Widget",
        upc: "012345678901",
        condition: "OPEN BOX",
        retail_price: 99.99,
        building_id: 15,
        current_bid: 5.00,
        is_open: true,
        total_bids: 3,
        watchers_count: 7,
      }));
    });

    const lot = await fetchLotItem(12345);
    expect(lot.id).toBe(12345);
    expect(lot.product_name).toBe("Test Widget");
    expect(lot.condition).toBe("OPEN BOX");
    expect(lot.current_bid).toBe(5.00);
    expect(lot.is_open).toBe(true);
  });

  it("should throw on non-OK response", async () => {
    mockFetch(async () => new Response("Not Found", { status: 404 }));
    expect(fetchLotItem(99999)).rejects.toThrow("Failed to fetch lot 99999");
  });
});

describe("extractImageUrls", () => {
  it("should extract URLs from 'images' array of strings", () => {
    const data = {
      images: [
        "https://media.mac.bid/stock.jpg",
        "https://media.mac.bid/photo1.jpg",
        "https://media.mac.bid/photo2.jpg",
      ],
    };
    expect(extractImageUrls(data)).toEqual([
      "https://media.mac.bid/stock.jpg",
      "https://media.mac.bid/photo1.jpg",
      "https://media.mac.bid/photo2.jpg",
    ]);
  });

  it("should extract URLs from 'images' array of objects with url field", () => {
    const data = {
      images: [
        { url: "https://media.mac.bid/stock.jpg" },
        { url: "https://media.mac.bid/photo1.jpg" },
      ],
    };
    expect(extractImageUrls(data)).toEqual([
      "https://media.mac.bid/stock.jpg",
      "https://media.mac.bid/photo1.jpg",
    ]);
  });

  it("should extract URLs from 'images' array of objects with src field", () => {
    const data = {
      images: [
        { src: "https://media.mac.bid/stock.jpg" },
      ],
    };
    expect(extractImageUrls(data)).toEqual(["https://media.mac.bid/stock.jpg"]);
  });

  it("should extract URLs from 'product_images' field", () => {
    const data = {
      product_images: ["https://media.mac.bid/img1.jpg", "https://media.mac.bid/img2.jpg"],
    };
    expect(extractImageUrls(data)).toEqual([
      "https://media.mac.bid/img1.jpg",
      "https://media.mac.bid/img2.jpg",
    ]);
  });

  it("should extract URLs from 'gallery' field", () => {
    const data = {
      gallery: ["https://media.mac.bid/g1.jpg"],
    };
    expect(extractImageUrls(data)).toEqual(["https://media.mac.bid/g1.jpg"]);
  });

  it("should fall back to single image_url when no array field exists", () => {
    const data = {
      image_url: "https://media.mac.bid/stock.jpg",
    };
    expect(extractImageUrls(data)).toEqual(["https://media.mac.bid/stock.jpg"]);
  });

  it("should fall back to stock_image_url when image_url is absent", () => {
    const data = {
      stock_image_url: "https://media.mac.bid/stock.jpg",
    };
    expect(extractImageUrls(data)).toEqual(["https://media.mac.bid/stock.jpg"]);
  });

  it("should return empty array when no image fields exist", () => {
    expect(extractImageUrls({})).toEqual([]);
  });

  it("should deduplicate URLs", () => {
    const data = {
      images: [
        "https://media.mac.bid/same.jpg",
        "https://media.mac.bid/same.jpg",
        "https://media.mac.bid/other.jpg",
      ],
    };
    expect(extractImageUrls(data)).toEqual([
      "https://media.mac.bid/same.jpg",
      "https://media.mac.bid/other.jpg",
    ]);
  });

  it("should skip empty strings in array", () => {
    const data = {
      images: ["https://media.mac.bid/stock.jpg", "", "https://media.mac.bid/photo.jpg"],
    };
    expect(extractImageUrls(data)).toEqual([
      "https://media.mac.bid/stock.jpg",
      "https://media.mac.bid/photo.jpg",
    ]);
  });

  it("should prepend image_url before array field entries", () => {
    const data = {
      images: ["https://media.mac.bid/from-array.jpg"],
      image_url: "https://media.mac.bid/single.jpg",
    };
    expect(extractImageUrls(data)).toEqual([
      "https://media.mac.bid/single.jpg",
      "https://media.mac.bid/from-array.jpg",
    ]);
  });

  it("should skip empty arrays and fall back to single field", () => {
    const data = {
      images: [],
      image_url: "https://media.mac.bid/fallback.jpg",
    };
    expect(extractImageUrls(data)).toEqual(["https://media.mac.bid/fallback.jpg"]);
  });
});

describe("fetchLotItem image_urls", () => {
  beforeEach(() => {
    restoreFetch();
  });

  afterEach(() => {
    restoreFetch();
  });

  it("should populate image_urls and stock_image_only from SSR data with multiple images", async () => {
    const ssrData = {
      id: 12345,
      auction_id: 100,
      lot_number: "42",
      product_name: "Test Widget",
      condition: "OPEN BOX",
      building_id: 15,
      current_bid: 5.00,
      is_open: true,
      total_bids: 3,
      watchers_count: 7,
      images: [
        "https://media.mac.bid/stock.jpg",
        "https://media.mac.bid/photo1.jpg",
        "https://media.mac.bid/photo2.jpg",
      ],
    };

    const lot = await fetchLotItem(12345, ssrData);
    expect(lot.image_urls).toEqual([
      "https://media.mac.bid/stock.jpg",
      "https://media.mac.bid/photo1.jpg",
      "https://media.mac.bid/photo2.jpg",
    ]);
    expect(lot.stock_image_only).toBe(false);
  });

  it("should combine stock image_url with product photos from images array", async () => {
    const ssrData = {
      id: 12345,
      auction_id: 100,
      lot_number: "42",
      product_name: "Test Widget",
      condition: "OPEN BOX",
      building_id: 15,
      current_bid: 5.00,
      is_open: true,
      total_bids: 3,
      watchers_count: 7,
      image_url: "https://media.mac.bid/stock.jpg",
      images: [
        { image_url: "https://media.mac.bid/photo1.jpg" },
      ],
    };

    const lot = await fetchLotItem(12345, ssrData);
    expect(lot.image_urls).toEqual([
      "https://media.mac.bid/stock.jpg",
      "https://media.mac.bid/photo1.jpg",
    ]);
    expect(lot.stock_image_only).toBe(false);
  });

  it("should mark stock_image_only when only one image exists", async () => {
    const ssrData = {
      id: 12345,
      auction_id: 100,
      lot_number: "42",
      product_name: "Test Widget",
      condition: "OPEN BOX",
      building_id: 15,
      current_bid: 5.00,
      is_open: true,
      total_bids: 3,
      watchers_count: 7,
      image_url: "https://media.mac.bid/stock.jpg",
    };

    const lot = await fetchLotItem(12345, ssrData);
    expect(lot.image_urls).toEqual(["https://media.mac.bid/stock.jpg"]);
    expect(lot.stock_image_only).toBe(true);
  });

  it("should mark stock_image_only when no images exist", async () => {
    const ssrData = {
      id: 12345,
      auction_id: 100,
      lot_number: "42",
      product_name: "Test Widget",
      condition: "OPEN BOX",
      building_id: 15,
      current_bid: 5.00,
      is_open: true,
      total_bids: 3,
      watchers_count: 7,
    };

    const lot = await fetchLotItem(12345, ssrData);
    expect(lot.image_urls).toEqual([]);
    expect(lot.stock_image_only).toBe(true);
  });

  it("should populate image_urls from DDB endpoint data", async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({
        id: 12345,
        auction_id: 100,
        lot_number: "42",
        product_name: "Test Widget",
        condition: "OPEN BOX",
        stock_image_url: "https://media.mac.bid/stock.jpg",
        current_bid: 5.00,
        is_open: true,
        total_bids: 3,
        watchers_count: 7,
      }));
    });

    const lot = await fetchLotItem(12345);
    expect(lot.image_urls).toEqual(["https://media.mac.bid/stock.jpg"]);
    expect(lot.stock_image_only).toBe(true);
  });
});
