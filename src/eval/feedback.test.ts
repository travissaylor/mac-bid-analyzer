/**
 * US-006 — Feedback plumbing smoke eval and additive-invariant regression guard.
 *
 * Two narrow tests that exercise the prompt builders directly (reusing the
 * same pattern as `src/llm/prompt.test.ts` and the image/search query tests).
 *
 * 1. Plumbing smoke: a distinctive rare token inside `userContext` must reach
 *    all three LLM prompts (search-query, image, estimate). This catches the
 *    worst failure mode — feedback being silently dropped before it hits any
 *    LLM call site.
 *
 * 2. Additive-invariant regression guard: with `userContext` absent, none of
 *    the prompts may contain the user-context marker or the steering line.
 *    This locks in the "strictly additive" invariant from US-002.
 */
import { describe, expect, it } from "bun:test";
import { buildUserPrompt } from "../llm/prompt";
import { buildImageAnalysisUserPrompt } from "../llm/image-prompt";
import { buildSearchQueryUserPrompt } from "../llm/search-query";
import type { LLMInput } from "../llm/index";
import type { ImageAnalysisInput } from "../llm/image-prompt";
import type { SearchQueryInput } from "../llm/search-query";

const DISTINCTIVE_TOKEN = "ZZQX-2022-model";
const USER_CONTEXT_MARKER = "User context (treat as authoritative):";
const STEERING_LINE = "If user context contradicts your own read of the product, prefer the user context.";

function baseEstimateInput(userContext?: string | null): LLMInput {
  return {
    productName: "Generic Widget",
    upc: null,
    condition: "OPEN BOX",
    retailPrice: 49.99,
    category: "Home",
    description: "A synthetic fixture lot for plumbing tests.",
    ebaySoldMedian: null,
    ebaySoldCount: null,
    ebaySearchQuery: null,
    ebaySearchStrategy: null,
    ebayFiltersRelaxed: null,
    userContext: userContext ?? undefined,
  };
}

function baseImageInput(userContext?: string | null): ImageAnalysisInput {
  return {
    productName: "Generic Widget",
    condition: "OPEN BOX",
    category: "Home",
    imageUrls: [
      "https://example.test/stock.jpg",
      "https://example.test/actual-1.jpg",
    ],
    userContext: userContext ?? undefined,
  };
}

function baseSearchInput(userContext?: string | null): SearchQueryInput {
  return {
    productName: "Generic Widget",
    description: "A synthetic fixture lot for plumbing tests.",
    upc: null,
    category: "Home",
    condition: "OPEN BOX",
    userContext: userContext ?? undefined,
  };
}

describe("feedback plumbing smoke eval (US-006)", () => {
  it("propagates a distinctive user-feedback token into all three LLM prompts", () => {
    const feedback = `This is actually a ${DISTINCTIVE_TOKEN} variant, not the stock one shown.`;

    const estimatePrompt = buildUserPrompt(baseEstimateInput(feedback));
    const imagePrompt = buildImageAnalysisUserPrompt(baseImageInput(feedback));
    const searchPrompt = buildSearchQueryUserPrompt(baseSearchInput(feedback));

    // Positive: the distinctive token reaches every prompt.
    expect(estimatePrompt).toContain(DISTINCTIVE_TOKEN);
    expect(imagePrompt).toContain(DISTINCTIVE_TOKEN);
    expect(searchPrompt).toContain(DISTINCTIVE_TOKEN);

    // Sanity: the authoritative-context marker is present when feedback is supplied.
    expect(estimatePrompt).toContain(USER_CONTEXT_MARKER);
    expect(imagePrompt).toContain(USER_CONTEXT_MARKER);
    expect(searchPrompt).toContain(USER_CONTEXT_MARKER);
  });
});

describe("feedback additive-invariant regression guard (US-006)", () => {
  it("produces pre-US-002-identical prompts when userContext is absent", () => {
    const estimatePrompt = buildUserPrompt(baseEstimateInput(undefined));
    const imagePrompt = buildImageAnalysisUserPrompt(baseImageInput(undefined));
    const searchPrompt = buildSearchQueryUserPrompt(baseSearchInput(undefined));

    for (const prompt of [estimatePrompt, imagePrompt, searchPrompt]) {
      expect(prompt).not.toContain(USER_CONTEXT_MARKER);
      expect(prompt).not.toContain(STEERING_LINE);
      expect(prompt).not.toContain("User context");
    }
  });

  it("treats an empty-string userContext the same as absent (no marker, no steering)", () => {
    const estimatePrompt = buildUserPrompt(baseEstimateInput(""));
    const imagePrompt = buildImageAnalysisUserPrompt(baseImageInput(""));
    const searchPrompt = buildSearchQueryUserPrompt(baseSearchInput(""));

    for (const prompt of [estimatePrompt, imagePrompt, searchPrompt]) {
      expect(prompt).not.toContain(USER_CONTEXT_MARKER);
      expect(prompt).not.toContain(STEERING_LINE);
    }
  });

  it("treats a whitespace-only userContext the same as absent (no marker, no steering)", () => {
    const whitespace = "   \n\t  ";
    const estimatePrompt = buildUserPrompt(baseEstimateInput(whitespace));
    const imagePrompt = buildImageAnalysisUserPrompt(baseImageInput(whitespace));
    const searchPrompt = buildSearchQueryUserPrompt(baseSearchInput(whitespace));

    for (const prompt of [estimatePrompt, imagePrompt, searchPrompt]) {
      expect(prompt).not.toContain(USER_CONTEXT_MARKER);
      expect(prompt).not.toContain(STEERING_LINE);
    }
  });
});
