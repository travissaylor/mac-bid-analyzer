import OpenAI from "openai";
import type { LLMProvider, LLMInput, LLMEstimate } from "./index";
import { buildPrompt, parseEstimateResponse } from "./prompt";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async estimate(input: LLMInput): Promise<LLMEstimate> {
    const prompt = buildPrompt(input);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI returned an empty response");
    }

    return parseEstimateResponse(content);
  }
}
