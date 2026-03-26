import { GoogleGenAI, type Content, type Part } from "@google/genai";
import type { LLMProvider, LLMInput, LLMEstimate } from "./index";
import type { ImageAnalysisInput, ImageAnalysisResult } from "./image-prompt";
import { IMAGE_ANALYSIS_SYSTEM_PROMPT, buildImageAnalysisUserPrompt, parseImageAnalysisResponse } from "./image-prompt";
import { fetchImageAsBase64 } from "./fetch-image";
import { buildPrompt, parseEstimateResponse } from "./prompt";

export class GeminiProvider implements LLMProvider {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async estimate(input: LLMInput): Promise<LLMEstimate> {
    const prompt = buildPrompt(input);

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        temperature: 0.1,
      },
    });

    const text = response.text;

    if (!text || typeof text !== "string") {
      throw new Error("Gemini returned no text content");
    }

    const estimate = parseEstimateResponse(text);

    const usageMetadata = response.usageMetadata;
    if (usageMetadata?.promptTokenCount != null && usageMetadata?.candidatesTokenCount != null) {
      estimate.usage = {
        inputTokens: usageMetadata.promptTokenCount,
        outputTokens: usageMetadata.candidatesTokenCount,
      };
    }

    return estimate;
  }

  async analyzeImages(input: ImageAnalysisInput): Promise<ImageAnalysisResult> {
    const userPrompt = buildImageAnalysisUserPrompt(input);

    // Build parts: system instruction as text, user text, then images
    const imageParts: Part[] = await Promise.all(
      input.imageUrls.map(async (url) => {
        const fetched = await fetchImageAsBase64(url);
        return {
          inlineData: {
            data: fetched.base64,
            mimeType: fetched.mimeType,
          },
        } satisfies Part;
      })
    );

    const contents: Content[] = [
      {
        role: "user",
        parts: [{ text: userPrompt }, ...imageParts],
      },
    ];

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction: IMAGE_ANALYSIS_SYSTEM_PROMPT,
        temperature: 0.1,
      },
    });

    const text = response.text;
    if (!text || typeof text !== "string") {
      throw new Error("Gemini returned no text content for image analysis");
    }

    return parseImageAnalysisResponse(text);
  }
}
