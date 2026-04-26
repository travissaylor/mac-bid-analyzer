export function calculateMaxBid(
  ebayMedian: number,
  discountThreshold: number,
  lotFee: number,
  buyersPremiumRate: number,
  salesTaxRate: number,
  locationCost: number
): number {
  const targetAllIn = ebayMedian * (1 - discountThreshold);
  const maxBid = (targetAllIn - lotFee - locationCost) / (1 + buyersPremiumRate + salesTaxRate);
  return Math.round(maxBid * 100) / 100;
}

export function calculateDealScore(recommendedMaxBid: number, currentBid: number): number {
  if (recommendedMaxBid <= 0) return 0;
  return ((recommendedMaxBid - currentBid) / recommendedMaxBid) * 100;
}
