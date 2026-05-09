import { ModelScore } from "../types/modelScore";

export function buildFallbackChain(
  scores: Record<string, ModelScore>,
  currentModelKey?: string
): string[] {
  const ordered = Object.entries(scores)
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([modelKey]) => modelKey);

  const seen = new Set<string>();
  const chain: string[] = [];

  if (currentModelKey && ordered.includes(currentModelKey)) {
    chain.push(currentModelKey);
    seen.add(currentModelKey);
  }

  for (const modelKey of ordered) {
    if (seen.has(modelKey)) {
      continue;
    }

    seen.add(modelKey);
    chain.push(modelKey);
  }

  return chain;
}
