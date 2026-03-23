const args = Bun.argv.slice(2);
const subcommand = args[0];

if (!subcommand) {
  console.log("Usage: bun run src/cli.ts <subcommand>");
  console.log("");
  console.log("Subcommands:");
  console.log("  analyze <url|lotId>  Analyze a single item");
  console.log("  watchlist            Analyze all watchlist items");
  console.log("  results              Query stored results");
  process.exit(1);
}

console.log(`[${new Date().toISOString()}] Subcommand "${subcommand}" not yet implemented.`);
process.exit(1);
