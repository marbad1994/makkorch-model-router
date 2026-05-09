import { REGISTRY } from "../config/registry";
import { RoutingDecision } from "../types/routingDecision";
import { buildFallbackChain } from "./buildFallbackChain";
import { classifyTask } from "./classifyTask";
import { parseIntent } from "./parseIntent";
import { scoreModels } from "./scoreModels";

export type ModelKey = keyof typeof REGISTRY;

function inferRequestedRegistryKey(model: unknown): string | undefined {
  const value = String(model ?? "").trim();

  if (!value) {
    return undefined;
  }

  if (REGISTRY[value as keyof typeof REGISTRY]) {
    return value;
  }

  const lower = value.toLowerCase();

  if (lower === "auto-cline-deep") {
    return undefined;
  }

  if (lower === "auto-cline-balanced") {
    return undefined;
  }

  if (lower === "auto-cline-fast") {
    return undefined;
  }

  if (lower === "auto-cline-free-first") {
    return undefined;
  }

  return undefined;
}

export function selectModel(requestBody: any): RoutingDecision {
  const body =
    requestBody && typeof requestBody === "object"
      ? requestBody
      : { model: String(requestBody ?? "auto-cline-balanced") };

  const intent = parseIntent(body);

  const task = classifyTask(body.messages ?? []);

  const scores = scoreModels(task, intent);

  const requestedModelKey = inferRequestedRegistryKey(body.model);

  const fallbackChain = buildFallbackChain(scores, requestedModelKey);

  if (fallbackChain.length === 0) {
    throw new Error("No available models found");
  }

  const scoreSummary = Object.entries(scores)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([key, score]) => ({
      model: key,
      total: Number(score.total.toFixed(2)),
      components: score.components
    }));

  console.log("========== ROUTING ==========");
  console.log("Model:", body.model ?? "auto-cline-balanced");
  console.log("Headers:", body._headers ?? body.headers ?? {});
  console.log("Task:", task);
  console.log("Intent:", intent);
  console.log("Requested registry model:", requestedModelKey ?? "(auto)");
  console.log("Scores:", scoreSummary);
  console.log("Fallback chain:", fallbackChain);
  console.log("=============================");

  return {
    modelKey: fallbackChain[0] as ModelKey,
    fallbackChain,
    intent,
    task,
    reason: "Selected by scoring engine"
  };
}
