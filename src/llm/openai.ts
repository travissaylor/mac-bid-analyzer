import OpenAI from "openai";
import type { LLMProvider, LLMInput, LLMEstimate } from "./index";
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
}
