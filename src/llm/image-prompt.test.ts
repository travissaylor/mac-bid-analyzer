import { describe, expect, it } from "bun:test";
import {
  buildImageAnalysisUserPrompt,
  parseImageAnalysisResponse,
  calculateImagePenalty,
  IMAGE_ANALYSIS_SYSTEM_PROMPT,
  SEVERITY_PENALTIES,
} from "./image-prompt";
import type { ImageAnalysisInput, ImageFinding } from "./image-prompt";

const sampleInput: ImageAnalysisInput = {
  productName: "MacBook Pro 14-inch M3",
  condition: "OPEN BOX",
  category: "Laptops",
  imageUrls: [
    "https://example.com/stock.jpg",
    "https://example.com/photo1.jpg",
    "https://example.com/photo2.jpg",
  ],
};

describe("llm/image-prompt", () => {
  describe("IMAGE_ANALYSIS_SYSTEM_PROMPT", () => {
    it("should instruct about damage detection", () => {
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("Physical damage");
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("cracks");
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("dents");
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("water damage");
    });

    it("should instruct about missing parts detection", () => {
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("Missing parts");
    });

    it("should instruct about mismatch detection", () => {
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("Mismatch");
    });

    it("should define severity levels", () => {
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("high");
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("medium");
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("low");
    });

    it("should request JSON response format", () => {
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("JSON");
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("findings");
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("overallRisk");
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("stockImageOnly");
    });

    it("should explain stockImageOnly behavior", () => {
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("stockImageOnly");
      expect(IMAGE_ANALYSIS_SYSTEM_PROMPT).toContain("stock/generic");
    });
  });

  describe("buildImageAnalysisUserPrompt", () => {
    it("should include product name, condition, and category", () => {
      const prompt = buildImageAnalysisUserPrompt(sampleInput);
      expect(prompt).toContain("Product: MacBook Pro 14-inch M3");
      expect(prompt).toContain("Listed Condition: OPEN BOX");
      expect(prompt).toContain("Category: Laptops");
    });

    it("should omit category when null", () => {
      const prompt = buildImageAnalysisUserPrompt({
        ...sampleInput,
        category: null,
      });
      expect(prompt).not.toContain("Category:");
    });

    it("should list all images with correct labels", () => {
      const prompt = buildImageAnalysisUserPrompt(sampleInput);
      expect(prompt).toContain("3 image(s) provided:");
      expect(prompt).toContain("Image 0: Stock/reference image");
      expect(prompt).toContain("Image 1: Actual product photo");
      expect(prompt).toContain("Image 2: Actual product photo");
    });

    it("should include mismatch comparison instruction when multiple images", () => {
      const prompt = buildImageAnalysisUserPrompt(sampleInput);
      expect(prompt).toContain("Compare the actual product photos against the stock image");
    });

    it("should not include mismatch comparison when only stock image", () => {
      const prompt = buildImageAnalysisUserPrompt({
        ...sampleInput,
        imageUrls: ["https://example.com/stock.jpg"],
      });
      expect(prompt).not.toContain("Compare the actual product photos");
    });

    it("should include inspection instruction", () => {
      const prompt = buildImageAnalysisUserPrompt(sampleInput);
      expect(prompt).toContain("Inspect all actual product photos carefully");
    });
  });

  describe("parseImageAnalysisResponse", () => {
    it("should parse a valid response with findings", () => {
      const text = JSON.stringify({
        findings: [
          { type: "damage", severity: "high", description: "Cracked screen visible", imageIndex: 1 },
          { type: "missing_parts", severity: "medium", description: "Power adapter not shown", imageIndex: 2 },
        ],
        overallRisk: 75,
        stockImageOnly: false,
      });
      const result = parseImageAnalysisResponse(text);
      expect(result.findings).toHaveLength(2);
      expect(result.findings[0].type).toBe("damage");
      expect(result.findings[0].severity).toBe("high");
      expect(result.findings[0].description).toBe("Cracked screen visible");
      expect(result.findings[0].imageIndex).toBe(1);
      expect(result.findings[1].type).toBe("missing_parts");
      expect(result.overallRisk).toBe(75);
      expect(result.stockImageOnly).toBe(false);
    });

    it("should parse a clean response with no findings", () => {
      const text = JSON.stringify({
        findings: [],
        overallRisk: 0,
        stockImageOnly: false,
      });
      const result = parseImageAnalysisResponse(text);
      expect(result.findings).toHaveLength(0);
      expect(result.overallRisk).toBe(0);
      expect(result.stockImageOnly).toBe(false);
    });

    it("should discard findings when stockImageOnly is true", () => {
      const text = JSON.stringify({
        findings: [
          { type: "damage", severity: "low", description: "Some artifact", imageIndex: 0 },
        ],
        overallRisk: 10,
        stockImageOnly: true,
      });
      const result = parseImageAnalysisResponse(text);
      expect(result.findings).toHaveLength(0);
      expect(result.overallRisk).toBe(0);
      expect(result.stockImageOnly).toBe(true);
    });

    it("should filter out findings with invalid types", () => {
      const text = JSON.stringify({
        findings: [
          { type: "unknown_type", severity: "high", description: "Bad type", imageIndex: 1 },
          { type: "damage", severity: "high", description: "Valid finding", imageIndex: 1 },
        ],
        overallRisk: 50,
        stockImageOnly: false,
      });
      const result = parseImageAnalysisResponse(text);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].description).toBe("Valid finding");
    });

    it("should filter out findings with invalid severities", () => {
      const text = JSON.stringify({
        findings: [
          { type: "damage", severity: "critical", description: "Bad severity", imageIndex: 1 },
        ],
        overallRisk: 30,
        stockImageOnly: false,
      });
      const result = parseImageAnalysisResponse(text);
      expect(result.findings).toHaveLength(0);
    });

    it("should filter out findings with empty descriptions", () => {
      const text = JSON.stringify({
        findings: [
          { type: "damage", severity: "low", description: "", imageIndex: 1 },
        ],
        overallRisk: 10,
        stockImageOnly: false,
      });
      const result = parseImageAnalysisResponse(text);
      expect(result.findings).toHaveLength(0);
    });

    it("should filter out findings with negative imageIndex", () => {
      const text = JSON.stringify({
        findings: [
          { type: "damage", severity: "low", description: "Scratch", imageIndex: -1 },
        ],
        overallRisk: 10,
        stockImageOnly: false,
      });
      const result = parseImageAnalysisResponse(text);
      expect(result.findings).toHaveLength(0);
    });

    it("should default overallRisk to 0 when out of range", () => {
      const text = JSON.stringify({
        findings: [],
        overallRisk: 150,
        stockImageOnly: false,
      });
      const result = parseImageAnalysisResponse(text);
      expect(result.overallRisk).toBe(0);
    });

    it("should default stockImageOnly to false when missing", () => {
      const text = JSON.stringify({
        findings: [],
        overallRisk: 0,
      });
      const result = parseImageAnalysisResponse(text);
      expect(result.stockImageOnly).toBe(false);
    });

    it("should handle markdown-wrapped responses", () => {
      const result = parseImageAnalysisResponse(
        '```json\n{"findings": [], "overallRisk": 0, "stockImageOnly": false}\n```'
      );
      expect(result.findings).toHaveLength(0);
      expect(result.overallRisk).toBe(0);
    });

    it("should throw when no JSON found", () => {
      expect(() => parseImageAnalysisResponse("no json here")).toThrow(
        "Could not parse JSON from image analysis response"
      );
    });

    it("should handle all three finding types", () => {
      const text = JSON.stringify({
        findings: [
          { type: "damage", severity: "high", description: "Cracked", imageIndex: 1 },
          { type: "missing_parts", severity: "medium", description: "No charger", imageIndex: 2 },
          { type: "mismatch", severity: "low", description: "Different color", imageIndex: 1 },
        ],
        overallRisk: 60,
        stockImageOnly: false,
      });
      const result = parseImageAnalysisResponse(text);
      expect(result.findings).toHaveLength(3);
      expect(result.findings.map((f) => f.type)).toEqual(["damage", "missing_parts", "mismatch"]);
    });
  });

  describe("calculateImagePenalty", () => {
    it("should return 0 for no findings", () => {
      expect(calculateImagePenalty([])).toBe(0);
    });

    it("should apply -20 for a high severity finding", () => {
      const findings: ImageFinding[] = [
        { type: "damage", severity: "high", description: "Cracked", imageIndex: 1 },
      ];
      expect(calculateImagePenalty(findings)).toBe(-20);
    });

    it("should apply -10 for a medium severity finding", () => {
      const findings: ImageFinding[] = [
        { type: "missing_parts", severity: "medium", description: "No charger", imageIndex: 1 },
      ];
      expect(calculateImagePenalty(findings)).toBe(-10);
    });

    it("should apply -5 for a low severity finding", () => {
      const findings: ImageFinding[] = [
        { type: "mismatch", severity: "low", description: "Slight color diff", imageIndex: 1 },
      ];
      expect(calculateImagePenalty(findings)).toBe(-5);
    });

    it("should accumulate penalties from multiple findings", () => {
      const findings: ImageFinding[] = [
        { type: "damage", severity: "high", description: "Cracked screen", imageIndex: 1 },
        { type: "damage", severity: "medium", description: "Dent on corner", imageIndex: 2 },
        { type: "missing_parts", severity: "low", description: "Missing docs", imageIndex: 2 },
      ];
      expect(calculateImagePenalty(findings)).toBe(-35); // -20 + -10 + -5
    });
  });

  describe("SEVERITY_PENALTIES", () => {
    it("should have correct penalty values", () => {
      expect(SEVERITY_PENALTIES.high).toBe(-20);
      expect(SEVERITY_PENALTIES.medium).toBe(-10);
      expect(SEVERITY_PENALTIES.low).toBe(-5);
    });
  });
});
