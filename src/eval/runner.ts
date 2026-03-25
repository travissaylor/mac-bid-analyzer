import { loadFixtures } from "./fixtures";
import type { AnnotatedFixtureItem } from "./fixtures";
import {
  parseModelString,
  getApiKeyForProvider,
  createProvider,
} from "../llm/index";
import type { LLMEstimate, LLMInput } from "../llm/index";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";

export interface ItemResult {
  lot_id: number;
  product_name: string;
  true_value: number;
  estimates: Record<
    string,
    {
      low: number;
      mid: number;
      high: number;
      confidence: number | null;
      cost_usd: number | null;
      latency_ms: number;
      error?: string;
    }
  >;
}

export interface ModelSummary {
  model: string;
  mae: number;
  mape: number;
  coverage_rate: number;
  avg_cost_usd: number | null;
  confidence_correlation: number | null;
  items_evaluated: number;
  items_errored: number;
}

export interface EvalReport {
  metadata: {
    run_at: string;
    fixture_path: string;
    models: string[];
    total_items: number;
  };
  summary: ModelSummary[];
  details: ItemResult[];
}

export interface PricingEntry {
  inputPer1M: number;
  outputPer1M: number;
}

export type PricingConfig = Record<string, PricingEntry>;

export interface RunEvalOptions {
  fixturePath: string;
  models: string[];
  env: { geminiApiKey: string; openaiApiKey: string };
  pricingPath?: string;
}

const DEFAULT_PRICING_PATH = "evals/pricing.json";

export async function loadPricing(pricingPath: string): Promise<PricingConfig> {
  try {
    const file = Bun.file(pricingPath);
    const text = await file.text();
    return JSON.parse(text) as PricingConfig;
  } catch {
    console.error(`Warning: Could not load pricing config from ${pricingPath}`);
    return {};
  }
}

export function calculateCost(
  usage: { inputTokens: number; outputTokens: number } | undefined,
  modelName: string,
  pricing: PricingConfig,
): number | null {
  if (!usage) return null;
  const entry = pricing[modelName];
  if (!entry) return null;
  return (
    (usage.inputTokens / 1_000_000) * entry.inputPer1M +
    (usage.outputTokens / 1_000_000) * entry.outputPer1M
  );
}

function fixtureToLLMInput(item: AnnotatedFixtureItem): LLMInput {
  return {
    productName: item.product_name,
    upc: item.upc,
    condition: item.condition,
    retailPrice: item.retail_price,
    category: item.category,
    description: item.description,
  };
}

function pearsonCorrelation(
  xs: number[],
  ys: number[],
): number | null {
  const n = xs.length;
  if (n < 2) return null;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  if (denom === 0) return null;
  return num / denom;
}

function computeModelSummary(
  modelString: string,
  details: ItemResult[],
): ModelSummary {
  let totalAbsError = 0;
  let totalPctError = 0;
  let mapeCount = 0;
  let coverageHits = 0;
  let evaluated = 0;
  let errored = 0;
  let totalCost = 0;
  let costCount = 0;
  const confidences: number[] = [];
  const accuracies: number[] = [];

  for (const item of details) {
    const est = item.estimates[modelString];
    if (!est) continue;
    if (est.error) {
      errored++;
      continue;
    }

    evaluated++;
    const absError = Math.abs(est.mid - item.true_value);
    totalAbsError += absError;

    if (item.true_value !== 0) {
      totalPctError += absError / item.true_value;
      mapeCount++;
    }

    if (item.true_value >= est.low && item.true_value <= est.high) {
      coverageHits++;
    }

    if (est.confidence !== null && item.true_value !== 0) {
      confidences.push(est.confidence);
      accuracies.push(1 - absError / item.true_value);
    }

    if (est.cost_usd !== null) {
      totalCost += est.cost_usd;
      costCount++;
    }
  }

  return {
    model: modelString,
    mae: evaluated > 0 ? totalAbsError / evaluated : 0,
    mape: mapeCount > 0 ? totalPctError / mapeCount : 0,
    coverage_rate: evaluated > 0 ? coverageHits / evaluated : 0,
    avg_cost_usd: costCount > 0 ? totalCost / costCount : null,
    confidence_correlation: pearsonCorrelation(confidences, accuracies),
    items_evaluated: evaluated,
    items_errored: errored,
  };
}

export async function runEval(options: RunEvalOptions): Promise<EvalReport> {
  const { fixturePath, models, env } = options;

  // Validate model strings and check API keys before starting
  const validatedModels: Array<{
    modelString: string;
    provider: string;
    model: string;
    apiKey: string;
  }> = [];
  const skippedModels: string[] = [];

  for (const modelString of models) {
    const { provider, model } = parseModelString(modelString);
    if (provider !== "gemini" && provider !== "openai") {
      throw new Error(
        `Unsupported provider "${provider}" in model "${modelString}". Supported: gemini, openai`,
      );
    }
    const apiKey = getApiKeyForProvider(provider, env);
    if (!apiKey) {
      console.error(
        `Skipping ${modelString} — no ${provider === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"} set`,
      );
      skippedModels.push(modelString);
      continue;
    }
    validatedModels.push({ modelString, provider, model, apiKey });
  }

  if (validatedModels.length === 0) {
    throw new Error("No models to evaluate — all models were skipped due to missing API keys");
  }

  // Load pricing config
  const pricingPath = options.pricingPath ?? DEFAULT_PRICING_PATH;
  const pricing = await loadPricing(pricingPath);

  // Warn about models missing from pricing config
  for (const { model, modelString } of validatedModels) {
    if (!pricing[model]) {
      console.error(`Warning: No pricing entry for model "${model}" — cost_usd will be null for ${modelString}`);
    }
  }

  // Load fixtures
  const { annotated, warnings } = await loadFixtures(fixturePath);

  for (const w of warnings) {
    console.error(w);
  }

  if (annotated.length === 0) {
    throw new Error(
      "No annotated items found — annotate true_value in the fixture file first",
    );
  }

  // Initialize details
  const details: ItemResult[] = annotated.map((item) => ({
    lot_id: item.lot_id,
    product_name: item.product_name,
    true_value: item.true_value,
    estimates: {},
  }));

  // Run all models in parallel, each processing items sequentially
  await Promise.all(
    validatedModels.map(async ({ modelString, provider, model, apiKey }) => {
      const llmProvider = await createProvider(provider, model, apiKey);

      for (let i = 0; i < annotated.length; i++) {
        const item = annotated[i];
        const input = fixtureToLLMInput(item);
        const start = performance.now();

        try {
          const estimate: LLMEstimate = await llmProvider.estimate(input);
          const latency = Math.round(performance.now() - start);
          const cost = calculateCost(estimate.usage, model, pricing);
          details[i].estimates[modelString] = {
            low: estimate.low,
            mid: estimate.mid,
            high: estimate.high,
            confidence: estimate.confidence,
            cost_usd: cost,
            latency_ms: latency,
          };
        } catch (err) {
          const latency = Math.round(performance.now() - start);
          details[i].estimates[modelString] = {
            low: 0,
            mid: 0,
            high: 0,
            confidence: null,
            cost_usd: null,
            latency_ms: latency,
            error: (err as Error).message,
          };
        }

        console.error(
          `[${model}] ${i + 1}/${annotated.length} items...`,
        );
      }
    }),
  );

  const allModelStrings = validatedModels.map((m) => m.modelString);
  const summary = allModelStrings.map((ms) => computeModelSummary(ms, details));

  const report: EvalReport = {
    metadata: {
      run_at: new Date().toISOString(),
      fixture_path: fixturePath,
      models: allModelStrings,
      total_items: annotated.length,
    },
    summary,
    details,
  };

  return report;
}

export async function saveReport(
  report: EvalReport,
  outputPath: string,
): Promise<void> {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  await Bun.write(outputPath, JSON.stringify(report, null, 2));
}

export function printSummaryTable(report: EvalReport): void {
  const { summary } = report;
  if (summary.length === 0) {
    console.log("No models evaluated.");
    return;
  }

  // Header
  const cols = [
    "Model",
    "MAE",
    "MAPE",
    "Coverage",
    "Avg Cost",
    "Confidence Corr",
    "Evaluated",
    "Errors",
  ];
  const rows = summary.map((s) => [
    s.model,
    `$${s.mae.toFixed(2)}`,
    `${(s.mape * 100).toFixed(1)}%`,
    `${(s.coverage_rate * 100).toFixed(1)}%`,
    s.avg_cost_usd !== null ? `$${s.avg_cost_usd.toFixed(4)}` : "N/A",
    s.confidence_correlation !== null
      ? s.confidence_correlation.toFixed(3)
      : "N/A",
    String(s.items_evaluated),
    String(s.items_errored),
  ]);

  // Calculate column widths
  const widths = cols.map((col, i) =>
    Math.max(col.length, ...rows.map((r) => r[i].length)),
  );

  const sep = widths.map((w) => "-".repeat(w)).join(" | ");
  const header = cols.map((c, i) => c.padEnd(widths[i])).join(" | ");

  console.log(header);
  console.log(sep);
  for (const row of rows) {
    console.log(row.map((c, i) => c.padEnd(widths[i])).join(" | "));
  }
}
