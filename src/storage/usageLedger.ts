import fs from "fs";
import path from "path";

const FILE_PATH = path.join(process.cwd(), "data", "usage.json");

interface UsageData {
  date: string;
  models: Record<string, number>;
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function load(): UsageData {
  if (!fs.existsSync(FILE_PATH)) {
    return {
      date: today(),
      models: {}
    };
  }

  const raw = fs.readFileSync(FILE_PATH, "utf8");
  const data = JSON.parse(raw) as UsageData;

  if (data.date !== today()) {
    return {
      date: today(),
      models: {}
    };
  }

  return data;
}

function save(data: UsageData) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
}

export function incrementUsage(modelKey: string) {
  const data = load();

  data.models[modelKey] = (data.models[modelKey] ?? 0) + 1;

  save(data);
}

export function getUsage(modelKey: string): number {
  const data = load();

  return data.models[modelKey] ?? 0;
}
