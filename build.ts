// Build script for the mac.bid Analyzer browser extension(s).
//
// Reads BACKEND_URL and API_TOKEN from .env (auto-loaded by Bun via Bun.env),
// emits extension/shared/config.generated.ts with those values baked in, then
// bundles each platform's entry points (content + service worker) into
// dist/<platform>/. Tolerates missing entry points so this script can be run
// before the per-platform source files have been created.

import { resolve } from "node:path";

const repoRoot = import.meta.dir;
const sharedDir = resolve(repoRoot, "extension/shared");

const written: string[] = [];
const skipped: string[] = [];

// 1. Resolve config from .env (Bun auto-loads .env into Bun.env).
const BACKEND_URL = Bun.env.BACKEND_URL ?? "http://localhost:3000";
const API_TOKEN = Bun.env.API_TOKEN ?? "";

if (!Bun.env.BACKEND_URL) {
  console.warn(
    `[build] BACKEND_URL not set in .env — defaulting to ${BACKEND_URL}`,
  );
}
if (!Bun.env.API_TOKEN) {
  console.warn(
    "[build] API_TOKEN not set in .env — using empty string. Backend calls will be unauthenticated.",
  );
}

// 2. Emit extension/shared/config.generated.ts.
const configPath = resolve(sharedDir, "config.generated.ts");
const configSource =
  `// GENERATED at build time from .env — do not edit by hand. Gitignored.\n` +
  `export const BACKEND_URL = ${JSON.stringify(BACKEND_URL)};\n` +
  `export const API_TOKEN = ${JSON.stringify(API_TOKEN)};\n`;
await Bun.write(configPath, configSource);
written.push(configPath);

// 3. Per-platform bundling helper.
type Entry = { src: string; outName: string };

async function buildPlatform(
  name: string,
  srcDir: string,
  outDir: string,
): Promise<void> {
  console.log(`\n[build] building ${name} → ${outDir}`);

  const entries: Entry[] = [
    { src: resolve(srcDir, "content.ts"), outName: "content.js" },
    {
      src: resolve(srcDir, "service-worker.ts"),
      outName: "service-worker.js",
    },
  ];

  const presentEntries: Entry[] = [];
  for (const entry of entries) {
    if (await Bun.file(entry.src).exists()) {
      presentEntries.push(entry);
    } else {
      console.warn(
        `[build] [${name}] entry point missing, skipping: ${entry.src}`,
      );
      skipped.push(entry.src);
    }
  }

  if (presentEntries.length > 0) {
    const result = await Bun.build({
      entrypoints: presentEntries.map((e) => e.src),
      outdir: outDir,
      format: "esm",
      target: "browser",
      minify: false,
      naming: "[name].js",
    });
    if (!result.success) {
      console.error(`[build] [${name}] Bun.build failed:`);
      for (const log of result.logs) console.error(log);
      process.exit(1);
    }
    for (const out of result.outputs) {
      written.push(out.path);
    }
  }

  // Copy manifest.
  const manifestSrc = resolve(srcDir, "manifest.json");
  const manifestDst = resolve(outDir, "manifest.json");
  if (await Bun.file(manifestSrc).exists()) {
    const manifestText = await Bun.file(manifestSrc).text();
    await Bun.write(manifestDst, manifestText);
    written.push(manifestDst);
  } else {
    console.warn(
      `[build] [${name}] manifest missing, skipping: ${manifestSrc}`,
    );
    skipped.push(manifestSrc);
  }
}

// 4. Build each platform.
await buildPlatform(
  "chrome",
  resolve(repoRoot, "extension/chrome"),
  resolve(repoRoot, "dist/chrome"),
);
await buildPlatform(
  "safari",
  resolve(repoRoot, "extension/safari"),
  resolve(repoRoot, "dist/safari"),
);

// 5. Summary.
console.log("\n[build] summary:");
console.log(`  wrote ${written.length} file(s):`);
for (const p of written) console.log(`    + ${p}`);
if (skipped.length > 0) {
  console.log(`  skipped ${skipped.length} missing input(s):`);
  for (const p of skipped) console.log(`    - ${p}`);
}
