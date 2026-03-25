import { GoogleGenAI } from "@google/genai";
import type { LLMProvider, LLMInput, LLMEstimate } from "./index";
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
}
