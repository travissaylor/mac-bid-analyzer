import type { FixtureItem } from "./export";

export interface AnnotatedFixtureItem extends Omit<FixtureItem, "true_value"> {
  true_value: number;
}

export interface LoadFixturesResult {
  annotated: AnnotatedFixtureItem[];
  skipped: number;
  warnings: string[];
}

export async function loadFixtures(
  fixturePath: string,
): Promise<LoadFixturesResult> {
  const file = Bun.file(fixturePath);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`Fixture file not found: ${fixturePath}`);
  }

  const text = await file.text();
  const lines = text.split("\n").filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    throw new Error("Fixture file is empty");
  }

  const warnings: string[] = [];
  const annotated: AnnotatedFixtureItem[] = [];
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    let item: FixtureItem;
    try {
      item = JSON.parse(lines[i]);
    } catch {
      throw new Error(`Invalid JSON on line ${i + 1} of fixture file`);
    }

    if (item.true_value === null || item.true_value === undefined) {
      skipped++;
      continue;
    }

    annotated.push(item as AnnotatedFixtureItem);
  }

  if (annotated.length < 5) {
    warnings.push(
      `Warning: Only ${annotated.length} item(s) have non-null true_value. At least 5 recommended for meaningful evaluation.`,
    );
  }

  return { annotated, skipped, warnings };
}
