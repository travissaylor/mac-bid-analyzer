export interface LLMComparable {
  name: string;
  estimatedPrice: number;
}

export interface LLMEstimate {
  low: number;
  mid: number;
  high: number;
  confidence: number | null;
  reasoning: string | null;
  comparables: LLMComparable[] | null;
}

export interface LLMInput {
  productName: string;
  upc: string | null;
  condition: string;
  retailPrice: number | null;
  category: string | null;
  description: string | null;
}

export interface LLMProvider {
  estimate(input: LLMInput): Promise<LLMEstimate>;
}
