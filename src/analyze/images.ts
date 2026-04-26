import type { ImageFinding } from "../llm/image-prompt";

/** Summarize image findings into a concise string for LLM context and review reasons. */
export function summarizeImageFindings(findings: ImageFinding[]): string {
  return findings
    .map(f => `[${f.severity.toUpperCase()}] ${f.type}: ${f.description}`)
    .join("\n");
}
