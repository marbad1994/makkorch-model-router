import fs from "fs";
import path from "path";

const FILE_PATH = path.join(process.cwd(), "data", "performance.json");

interface CategoryStats {
  success: number;
  failure: number;
}

interface PerformanceData {
  models: Record<string, Record<string, CategoryStats>>;
}

function emptyData(): PerformanceData {
  return { models: {} };
}

function load(): PerformanceData {
  if (!fs.existsSync(FILE_PATH)) {
    return emptyData();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(FILE_PATH, "utf8"));

    if (!parsed.models || typeof parsed.models !== "object") {
      return emptyData();
    }

    return parsed as PerformanceData;
  } catch {
    return emptyData();
  }
}

function save(data: PerformanceData) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
}

function ensure(data: PerformanceData, modelKey: string, taskType: string) {
  data.models[modelKey] ??= {};
  data.models[modelKey][taskType] ??= {
    success: 0,
    failure: 0
  };
}

export function recordSuccess(modelKey: string, taskType: string) {
  const data = load();
  ensure(data, modelKey, taskType);
  data.models[modelKey][taskType].success++;
  save(data);
}

export function recordFailure(modelKey: string, taskType: string) {
  const data = load();
  ensure(data, modelKey, taskType);
  data.models[modelKey][taskType].failure++;
  save(data);
}

export function getFailureRate(modelKey: string, taskType: string): number {
  const data = load();

  const stats = data.models[modelKey]?.[taskType];

  if (!stats) {
    return 0;
  }

  const total = stats.success + stats.failure;

  if (total === 0) {
    return 0;
  }

  return stats.failure / total;
}
