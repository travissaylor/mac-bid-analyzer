import OpenAI from "openai";
import type { LLMProvider, LLMInput, LLMEstimate } from "./index";
import type { ImageAnalysisInput, ImageAnalysisResult } from "./image-prompt";
import { IMAGE_ANALYSIS_SYSTEM_PROMPT, buildImageAnalysisUserPrompt, parseImageAnalysisResponse } from "./image-prompt";
import { fetchImageAsBase64 } from "./fetch-image";
import { SYSTEM_PROMPT, buildUserPrompt, parseEstimateResponse } from "./prompt";

const MODELS_DEFAULT_TEMP_ONLY = new Set(["gpt-5-mini", "gpt-5-nano"]);

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async estimate(input: LLMInput): Promise<LLMEstimate> {
    const userPrompt = buildUserPrompt(input);
    const temperature = MODELS_DEFAULT_TEMP_ONLY.has(this.model) ? undefined : 0.1;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI returned an empty response");
    }

    const estimate = parseEstimateResponse(content);

    if (response.usage) {
      estimate.usage = {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      };
    }

    return estimate;
  }

  async analyzeImages(input: ImageAnalysisInput): Promise<ImageAnalysisResult> {
    const userPrompt = buildImageAnalysisUserPrompt(input);
    const temperature = MODELS_DEFAULT_TEMP_ONLY.has(this.model) ? undefined : 0.1;

    // Build image content parts as base64 data URLs
    const imageContentParts: OpenAI.Chat.Completions.ChatCompletionContentPartImage[] = await Promise.all(
      input.imageUrls.map(async (url) => {
        const fetched = await fetchImageAsBase64(url);
        return {
          type: "image_url" as const,
          image_url: {
            url: `data:${fetched.mimeType};base64,${fetched.base64}`,
          },
        };
      })
    );

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: IMAGE_ANALYSIS_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            ...imageContentParts,
          ],
        },
      ],
      temperature,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI returned an empty response for image analysis");
    }

    return parseImageAnalysisResponse(content);
  }
}
