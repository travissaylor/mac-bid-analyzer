import { describe, expect, it, mock, beforeEach } from "bun:test";
import type { ImageAnalysisInput } from "./image-prompt";

// Mock fetch globally for image fetching
const originalFetch = globalThis.fetch;

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

const validLLMResponse = JSON.stringify({
  findings: [
    { type: "damage", severity: "high", description: "Cracked screen", imageIndex: 1 },
    { type: "missing_parts", severity: "medium", description: "No charger shown", imageIndex: 2 },
  ],
  overallRisk: 65,
  stockImageOnly: false,
});

const stockOnlyResponse = JSON.stringify({
  findings: [],
  overallRisk: 0,
  stockImageOnly: true,
});

// Tiny 1x1 JPEG as base64 (smallest valid JPEG)
const TINY_JPEG_BASE64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMCwsKCwsM";

function createMockImageFetch() {
  return mock((_url: string | URL | Request) => {
    return Promise.resolve(
      new Response(Buffer.from(TINY_JPEG_BASE64, "base64"), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })
    );
  });
}

describe("GeminiProvider.analyzeImages", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should send images as inlineData and parse the response", async () => {
    const mockFetch = createMockImageFetch();

    // Track the Gemini API call
    let capturedContents: unknown = null;
    let capturedConfig: unknown = null;

    // We need to mock the GoogleGenAI class
    const { GeminiProvider } = await import("./gemini");

    const provider = new GeminiProvider("fake-api-key", "gemini-2.0-flash");

    // Override the ai.models.generateContent method
    (provider as any).ai = {
      models: {
        generateContent: mock(async (params: any) => {
          capturedContents = params.contents;
          capturedConfig = params.config;
          return { text: validLLMResponse };
        }),
      },
    };

    globalThis.fetch = mockFetch as any;

    const result = await provider.analyzeImages(sampleInput);

    // Verify images were fetched
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify result parsing
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].type).toBe("damage");
    expect(result.findings[0].severity).toBe("high");
    expect(result.findings[1].type).toBe("missing_parts");
    expect(result.overallRisk).toBe(65);
    expect(result.stockImageOnly).toBe(false);

    // Verify contents structure
    const contents = capturedContents as any[];
    expect(contents).toHaveLength(1);
    expect(contents[0].role).toBe("user");
    // First part should be text, then 3 image parts
    expect(contents[0].parts).toHaveLength(4);
    expect(contents[0].parts[0].text).toBeDefined();
    expect(contents[0].parts[1].inlineData).toBeDefined();
    expect(contents[0].parts[2].inlineData).toBeDefined();
    expect(contents[0].parts[3].inlineData).toBeDefined();

    // Verify system instruction is set
    const config = capturedConfig as any;
    expect(config.systemInstruction).toContain("product condition inspector");
    expect(config.temperature).toBe(0.1);
  });

  it("should handle stockImageOnly response", async () => {
    globalThis.fetch = createMockImageFetch() as any;

    const { GeminiProvider } = await import("./gemini");
    const provider = new GeminiProvider("fake-api-key", "gemini-2.0-flash");

    (provider as any).ai = {
      models: {
        generateContent: mock(async () => ({ text: stockOnlyResponse })),
      },
    };

    const result = await provider.analyzeImages(sampleInput);
    expect(result.findings).toHaveLength(0);
    expect(result.overallRisk).toBe(0);
    expect(result.stockImageOnly).toBe(true);
  });

  it("should throw when Gemini returns no text", async () => {
    globalThis.fetch = createMockImageFetch() as any;

    const { GeminiProvider } = await import("./gemini");
    const provider = new GeminiProvider("fake-api-key", "gemini-2.0-flash");

    (provider as any).ai = {
      models: {
        generateContent: mock(async () => ({ text: null })),
      },
    };

    await expect(provider.analyzeImages(sampleInput)).rejects.toThrow(
      "Gemini returned no text content for image analysis"
    );
  });
});

describe("OpenAIProvider.analyzeImages", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should send images as base64 data URLs and parse the response", async () => {
    const mockFetch = createMockImageFetch();

    let capturedMessages: unknown = null;

    const { OpenAIProvider } = await import("./openai");
    const provider = new OpenAIProvider("fake-api-key", "gpt-4o");

    // Override the client
    (provider as any).client = {
      chat: {
        completions: {
          create: mock(async (params: any) => {
            capturedMessages = params.messages;
            return {
              choices: [{ message: { content: validLLMResponse } }],
            };
          }),
        },
      },
    };

    globalThis.fetch = mockFetch as any;

    const result = await provider.analyzeImages(sampleInput);

    // Verify images were fetched
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify result parsing
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].type).toBe("damage");
    expect(result.overallRisk).toBe(65);
    expect(result.stockImageOnly).toBe(false);

    // Verify message structure
    const messages = capturedMessages as any[];
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("product condition inspector");

    // User message should have text + image parts
    expect(messages[1].role).toBe("user");
    const content = messages[1].content as any[];
    expect(content[0].type).toBe("text");
    expect(content[1].type).toBe("image_url");
    expect(content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(content[2].type).toBe("image_url");
    expect(content[3].type).toBe("image_url");
  });

  it("should handle stockImageOnly response", async () => {
    globalThis.fetch = createMockImageFetch() as any;

    const { OpenAIProvider } = await import("./openai");
    const provider = new OpenAIProvider("fake-api-key", "gpt-4o");

    (provider as any).client = {
      chat: {
        completions: {
          create: mock(async () => ({
            choices: [{ message: { content: stockOnlyResponse } }],
          })),
        },
      },
    };

    const result = await provider.analyzeImages(sampleInput);
    expect(result.findings).toHaveLength(0);
    expect(result.stockImageOnly).toBe(true);
  });

  it("should throw when OpenAI returns empty response", async () => {
    globalThis.fetch = createMockImageFetch() as any;

    const { OpenAIProvider } = await import("./openai");
    const provider = new OpenAIProvider("fake-api-key", "gpt-4o");

    (provider as any).client = {
      chat: {
        completions: {
          create: mock(async () => ({
            choices: [{ message: { content: null } }],
          })),
        },
      },
    };

    await expect(provider.analyzeImages(sampleInput)).rejects.toThrow(
      "OpenAI returned an empty response for image analysis"
    );
  });

  it("should use json_object response format", async () => {
    globalThis.fetch = createMockImageFetch() as any;

    let capturedParams: any = null;

    const { OpenAIProvider } = await import("./openai");
    const provider = new OpenAIProvider("fake-api-key", "gpt-4o");

    (provider as any).client = {
      chat: {
        completions: {
          create: mock(async (params: any) => {
            capturedParams = params;
            return {
              choices: [{ message: { content: validLLMResponse } }],
            };
          }),
        },
      },
    };

    await provider.analyzeImages(sampleInput);
    expect(capturedParams.response_format).toEqual({ type: "json_object" });
  });
});

describe("fetchImageAsBase64", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should fetch image and return base64 with mime type", async () => {
    const imageBuffer = Buffer.from("fake-image-data");
    globalThis.fetch = mock(async () =>
      new Response(imageBuffer, {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    ) as any;

    const { fetchImageAsBase64 } = await import("./fetch-image");
    const result = await fetchImageAsBase64("https://example.com/test.png");

    expect(result.base64).toBe(imageBuffer.toString("base64"));
    expect(result.mimeType).toBe("image/png");
  });

  it("should throw on non-OK response", async () => {
    globalThis.fetch = mock(async () =>
      new Response(null, { status: 404, statusText: "Not Found" })
    ) as any;

    const { fetchImageAsBase64 } = await import("./fetch-image");
    await expect(fetchImageAsBase64("https://example.com/missing.jpg")).rejects.toThrow(
      "Failed to fetch image"
    );
  });

  it("should default to image/jpeg when no content-type", async () => {
    globalThis.fetch = mock(async () =>
      new Response(Buffer.from("data"), { status: 200 })
    ) as any;

    const { fetchImageAsBase64 } = await import("./fetch-image");
    const result = await fetchImageAsBase64("https://example.com/test.jpg");
    expect(result.mimeType).toBe("image/jpeg");
  });
});
