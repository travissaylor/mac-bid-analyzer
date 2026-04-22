import { describe, it, expect } from "bun:test";
import { extractLotInfo } from "./lot-url";

describe("extractLotInfo", () => {
  it("parses an /auction/{id}/lot/{lotNumber} path", () => {
    const result = extractLotInfo("https://www.mac.bid/auction/79197/lot/1426Z");
    expect(result).toEqual({
      type: "auction_lot",
      auctionId: "79197",
      lotNumber: "1426Z",
      lotId: "1426Z",
      path: "/auction/79197/lot/1426Z",
    });
  });

  it("parses a numeric /lot/{lotId} permalink", () => {
    const result = extractLotInfo("https://www.mac.bid/lot/44444");
    expect(result).toEqual({
      type: "lot",
      lotId: "44444",
      path: "/lot/44444",
    });
  });

  it("parses a search page with numeric aid and lid query params", () => {
    const result = extractLotInfo(
      "https://www.mac.bid/search?q=bike&aid=79162&lid=1426Z",
    );
    expect(result).toEqual({
      type: "auction_lot",
      auctionId: "79162",
      lotNumber: "1426Z",
      lotId: "1426Z",
      path: "/auction/79162/lot/1426Z",
    });
  });

  it("parses a watchlist page with an alphanumeric aid", () => {
    const result = extractLotInfo(
      "https://www.mac.bid/account/watchlist?aid=PA2604-22-A1&lid=1426Z",
    );
    expect(result).toEqual({
      type: "auction_lot",
      auctionId: "PA2604-22-A1",
      lotNumber: "1426Z",
      lotId: "1426Z",
      path: "/auction/PA2604-22-A1/lot/1426Z",
    });
  });

  it("parses an arbitrary path with only lid and no aid", () => {
    const result = extractLotInfo("https://www.mac.bid/any/path?lid=1426Z");
    expect(result).toEqual({
      type: "auction_lot",
      auctionId: undefined,
      lotNumber: "1426Z",
      lotId: "1426Z",
      path: "/lot/1426Z",
    });
  });

  it("returns null for a search page with no lid", () => {
    expect(extractLotInfo("https://www.mac.bid/search?q=bike")).toBeNull();
  });

  it("returns null for an unrelated page", () => {
    expect(extractLotInfo("https://www.mac.bid/")).toBeNull();
  });
});
