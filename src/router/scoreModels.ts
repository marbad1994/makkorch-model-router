import { REGISTRY } from "../config/registry";
import { getFailureRate } from "../storage/modelPerformance";
import { getUsage } from "../storage/usageLedger";
import { ModelScore } from "../types/modelScore";
import { RoutingIntent } from "../types/router";
import { TaskProfile } from "../types/task";
import { filterAvailableModels } from "./filterAvailableModels";

function taskStrengthBonus(task: TaskProfile, strengths: string[]): number {
  let bonus = 0;

  if (task.taskType === "architecture") {
    if (strengths.includes("architecture")) bonus += 22;
    if (strengths.includes("large_scope")) bonus += 12;
    if (strengths.includes("reasoning")) bonus += 10;
  }

  if (task.taskType === "debugging") {
    if (strengths.includes("debugging")) bonus += 22;
    if (strengths.includes("reasoning")) bonus += 10;
    if (strengths.includes("hard_logic")) bonus += 8;
  }

  if (task.taskType === "implementation") {
    if (strengths.includes("implementation")) bonus += 18;
    if (strengths.includes("coding")) bonus += 10;
    if (strengths.includes("agentic_edits")) bonus += 8;
  }

  if (task.taskType === "refactor") {
    if (strengths.includes("small_refactor")) bonus += 14;
    if (strengths.includes("multi_file")) bonus += 14;
    if (strengths.includes("coding")) bonus += 8;
  }

  if (task.taskType === "small_edit") {
    if (strengths.includes("tiny_edits")) bonus += 14;
    if (strengths.includes("formatting")) bonus += 8;
    if (strengths.includes("quick_code")) bonus += 6;
  }

  if (task.taskType === "docs") {
    if (strengths.includes("docs")) bonus += 16;
    if (strengths.includes("simple_code")) bonus += 4;
  }

  if (task.taskType === "testing") {
    if (strengths.includes("testing")) bonus += 16;
    if (strengths.includes("debugging")) bonus += 8;
  }

  return bonus;
}

function profileBonus(
  intent: RoutingIntent,
  model: (typeof REGISTRY)[keyof typeof REGISTRY]
): number {
  let bonus = 0;

  if (intent.profile === "fast") {
    bonus += model.speed * 1.8;
    bonus -= model.cost * 0.7;
  }

  if (intent.profile === "balanced") {
    bonus += model.quality * 1.5;
    bonus += model.speed * 0.8;
    bonus -= model.cost * 0.4;
  }

  if (intent.profile === "deep") {
    bonus += model.quality * 4;
    bonus += model.cost <= 3 ? 2 : 0;

    if (model.strengths.includes("reasoning")) bonus += 8;
    if (model.strengths.includes("architecture")) bonus += 8;
    if (model.strengths.includes("large_scope")) bonus += 8;
    if (model.provider === "claudeBedrock" || model.provider === "claudeDirect")
      bonus += 8;
  }

  if (intent.profile === "free-first") {
    if (model.cost === 0) bonus += 24;
    else if (model.cost <= 1) bonus += 16;
    else bonus -= model.cost * 6;

    if (model.local) bonus += 12;
    if (model.provider === "nvidia") bonus += 8;
  }

  if (intent.preferLocal) {
    bonus += model.local ? 18 : -6;
  }

  return bonus;
}

export function scoreModels(
  task: TaskProfile,
  intent: RoutingIntent
): Record<string, ModelScore> {
  const scores: Record<string, ModelScore> = {};
  const available = filterAvailableModels();

  for (const [key, model] of Object.entries(REGISTRY)) {
    if (!available.includes(key)) {
      continue;
    }

    if (!intent.allowPaid && model.cost > 1) {
      continue;
    }

    const qualityScore = model.quality * 3;

    const usageToday = getUsage(key);
    const usagePenalty = usageToday * 0.5;

    const failureRate = getFailureRate(key, task.taskType);
    const failurePenalty = failureRate * 20;

    const speedDistance = Math.abs(model.speed - intent.speedSensitivity);
    const speedFit = Math.max(0, 10 - speedDistance);

    const latency = Number.isFinite(model.latency) ? model.latency : 5;
    const latencyDistance = Math.abs(latency - intent.speedSensitivity);
    const latencyFit = Math.max(0, 8 - latencyDistance);

    const taskBonus = taskStrengthBonus(task, model.strengths);
    let preferenceBonus = profileBonus(intent, model);

    if (model.provider === "nvidia" && intent.profile !== "deep") {
      preferenceBonus += 6;
    }

    const total =
      qualityScore -
      usagePenalty -
      failurePenalty +
      speedFit +
      latencyFit +
      taskBonus +
      preferenceBonus;

    scores[key] = {
      total,
      components: {
        quality: qualityScore,
        usagePenalty,
        failurePenalty,
        speedFit,
        latencyFit,
        taskBonus,
        preferenceBonus
      }
    };
  }

  return scores;
}
