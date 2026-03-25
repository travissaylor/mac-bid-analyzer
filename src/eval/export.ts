import { openDatabase, getAllItems } from "../db";
import type { AnalyzedItem } from "../db";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";

export interface FixtureItem {
  lot_id: number;
  product_name: string;
  upc: string | null;
  condition: string;
  retail_price: number | null;
  category: string | null;
  description: string | null;
  ebay_sold_median: number | null;
  ebay_sold_count: number;
  true_value: number | null;
}

export function toFixtureItem(item: AnalyzedItem): FixtureItem {
  return {
    lot_id: item.lot_id,
    product_name: item.product_name,
    upc: item.upc,
    condition: item.condition,
    retail_price: item.retail_price,
    category: item.category,
    description: item.description,
    ebay_sold_median: item.ebay_sold_median,
    ebay_sold_count: item.ebay_sold_count,
    true_value: null,
  };
}

export async function exportFixtures(outputPath: string): Promise<number> {
  const db = openDatabase();
  try {
    const items = getAllItems(db);
    const valid = items.filter((item) => item.product_name);

    if (valid.length === 0) {
      console.log("No items to export.");
      return 0;
    }

    const lines = valid.map((item) => JSON.stringify(toFixtureItem(item)));
    const content = lines.join("\n") + "\n";

    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    await Bun.write(outputPath, content);
    console.log(`Exported ${valid.length} items to ${outputPath}`);
    return valid.length;
  } finally {
    db.close();
  }
}
