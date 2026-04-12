/**
 * Image analysis prompt and response types for detecting red flags in product photos.
 */

// --- Types ---

export type ImageFindingType = "damage" | "missing_parts" | "mismatch";
export type ImageFindingSeverity = "high" | "medium" | "low";

export interface ImageFinding {
  type: ImageFindingType;
  severity: ImageFindingSeverity;
  description: string;
  imageIndex: number;
}

export interface ImageAnalysisResult {
  findings: ImageFinding[];
  overallRisk: number;
  stockImageOnly: boolean;
}

export interface ImageAnalysisInput {
  productName: string;
  condition: string;
  category: string | null;
  /** All image URLs. First is stock, rest are actual product photos. */
  imageUrls: string[];
  /** Optional user-provided context to inject into the prompt as authoritative. */
  userContext?: string | null;
}

// --- Severity penalties ---

export const SEVERITY_PENALTIES: Record<ImageFindingSeverity, number> = {
  high: -20,
  medium: -10,
  low: -5,
};

// --- Prompt ---

export const IMAGE_ANALYSIS_SYSTEM_PROMPT = `You are a product condition inspector. You are given photos of an item being sold at auction. Your job is to identify physical defects, missing parts, and mismatches between the product listing and what is shown in the photos.

Image numbering: Image 0 is the stock/reference image. Images 1+ are actual product photos taken of the specific item being sold.

Look for:
1. **Physical damage** — cracks, dents, scratches, scuffs, water damage, discoloration, broken parts, bent components. Severity guide:
   - high: Cracked screen, significant dents, water damage, broken structural parts
   - medium: Noticeable scratches, minor dents on visible surfaces, cosmetic damage
   - low: Hairline scratches, minor scuffs, light wear marks

2. **Missing parts or accessories** — empty slots, missing cables, missing stands, missing covers or panels, absent accessories that should be included. Severity guide:
   - high: Key functional components missing (e.g., power adapter for laptop, remote for TV)
   - medium: Notable accessories missing (e.g., stylus, extra cables, documentation)
   - low: Minor accessories missing (e.g., extra ear tips, cable ties)

3. **Mismatch** — the actual product photos don't match the stock image or product name. The item shown is a different model, color, size, or product entirely. Severity guide:
   - high: Completely different product, wrong model number, obviously different item
   - medium: Same product line but different variant (wrong color, different size)
   - low: Minor discrepancy (slightly different revision, updated packaging)

If the photos appear to all be stock/generic marketing images (no actual product-specific photos showing the real item), set "stockImageOnly" to true and return an empty findings array.

Respond with ONLY a JSON object in this exact format, no other text:
{"findings": [{"type": "<damage|missing_parts|mismatch>", "severity": "<high|medium|low>", "description": "<string>", "imageIndex": <number>}], "overallRisk": <number 0-100>, "stockImageOnly": <boolean>}

Where:
- "findings" is an array of issues found (empty array if none or if stockImageOnly is true)
- "type" is one of: "damage", "missing_parts", "mismatch"
- "severity" is one of: "high", "medium", "low"
- "description" is a brief, specific description of the issue
- "imageIndex" is which image the issue was spotted in (0 = stock, 1+ = actual photos)
- "overallRisk" is a score from 0-100 (0 = no issues, 100 = severe problems)
- "stockImageOnly" is true if all provided images appear to be stock/generic photos`;

export function buildImageAnalysisUserPrompt(input: ImageAnalysisInput): string {
  const lines: string[] = [
    `Product: ${input.productName}`,
    `Listed Condition: ${input.condition}`,
  ];

  if (input.category) {
    lines.push(`Category: ${input.category}`);
  }

  lines.push("");
  lines.push(`${input.imageUrls.length} image(s) provided:`);
  lines.push(`- Image 0: Stock/reference image`);
  for (let i = 1; i < input.imageUrls.length; i++) {
    lines.push(`- Image ${i}: Actual product photo`);
  }

  if (input.imageUrls.length > 1) {
    lines.push("");
    lines.push("Compare the actual product photos against the stock image to check for mismatches.");
  }

  lines.push("");
  lines.push("Inspect all actual product photos carefully and report any issues found.");

  if (input.userContext && input.userContext.trim().length > 0) {
    lines.push("");
    lines.push("User context (treat as authoritative):");
    lines.push(input.userContext);
  }

  return lines.join("\n");
}

// --- Response parsing ---

const VALID_FINDING_TYPES: Set<string> = new Set(["damage", "missing_parts", "mismatch"]);
const VALID_SEVERITIES: Set<string> = new Set(["high", "medium", "low"]);

/** Extract the outermost JSON object from text using brace counting. */
function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** Parse and validate an LLM JSON response into an ImageAnalysisResult. */
export function parseImageAnalysisResponse(text: string): ImageAnalysisResult {
  const jsonStr = extractJson(text);
  if (!jsonStr) {
    throw new Error(`Could not parse JSON from image analysis response: ${text}`);
  }

  const parsed = JSON.parse(jsonStr);

  const stockImageOnly = typeof parsed.stockImageOnly === "boolean" ? parsed.stockImageOnly : false;

  const overallRisk =
    typeof parsed.overallRisk === "number" &&
    parsed.overallRisk >= 0 &&
    parsed.overallRisk <= 100
      ? parsed.overallRisk
      : 0;

  const findings: ImageFinding[] = [];
  if (Array.isArray(parsed.findings)) {
    for (const f of parsed.findings) {
      if (
        f &&
        typeof f === "object" &&
        VALID_FINDING_TYPES.has(f.type) &&
        VALID_SEVERITIES.has(f.severity) &&
        typeof f.description === "string" &&
        f.description.length > 0 &&
        typeof f.imageIndex === "number" &&
        f.imageIndex >= 0
      ) {
        findings.push({
          type: f.type as ImageFindingType,
          severity: f.severity as ImageFindingSeverity,
          description: f.description,
          imageIndex: f.imageIndex,
        });
      }
    }
  }

  // If stock-only, discard any findings
  if (stockImageOnly) {
    return { findings: [], overallRisk: 0, stockImageOnly: true };
  }

  return { findings, overallRisk, stockImageOnly };
}

/** Calculate the total confidence penalty from image findings. */
export function calculateImagePenalty(findings: ImageFinding[]): number {
  let penalty = 0;
  for (const finding of findings) {
    penalty += SEVERITY_PENALTIES[finding.severity];
  }
  return penalty;
}
