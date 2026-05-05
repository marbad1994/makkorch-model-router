import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { NormalizedTokenUsage } from "../router/tokenUsage";

<<<<<<< HEAD
export type ModelRunStatus = "success" | "failed" | "rejected" | "suspicious";

export type ModelRunMode = "chat" | "stream";
=======
export type ModelRunStatus =
  | "success"
  | "failed"
  | "rejected"
  | "suspicious";

export type ModelRunMode =
  | "chat"
  | "stream";
>>>>>>> c6972ae (init commit)

export type ModelRunRecord = {
  id: string;
  timestamp: number;
  requestId?: string;

  mode: ModelRunMode;
  taskType?: string;

  modelKey: string;
  provider: string;
  providerModel: string;

  status: ModelRunStatus;
  latencyMs: number;

  tokenUsage: NormalizedTokenUsage;

  fallbackIndex?: number;
  judgeReason?: string;
  error?: string;

  inputChars: number;
  outputChars: number;
};

const DEFAULT_LEDGER_PATH = path.join(process.cwd(), "data", "model-runs.jsonl");

function ledgerPath(): string {
  return process.env.MODEL_RUN_LEDGER_PATH ?? DEFAULT_LEDGER_PATH;
}

function makeId(): string {
  return `run_${crypto.randomUUID()}`;
}

async function ensureLedgerDir(): Promise<void> {
  await fs.mkdir(path.dirname(ledgerPath()), { recursive: true });
}

export async function logModelRun(
  record: Omit<ModelRunRecord, "id" | "timestamp">
): Promise<ModelRunRecord> {
  const fullRecord: ModelRunRecord = {
    id: makeId(),
    timestamp: Date.now(),
    ...record
  };

  await ensureLedgerDir();

<<<<<<< HEAD
  await fs.appendFile(ledgerPath(), `${JSON.stringify(fullRecord)}\n`, "utf8");
=======
  await fs.appendFile(
    ledgerPath(),
    `${JSON.stringify(fullRecord)}\n`,
    "utf8"
  );
>>>>>>> c6972ae (init commit)

  return fullRecord;
}

export async function logModelRunSafely(
  record: Omit<ModelRunRecord, "id" | "timestamp">
): Promise<void> {
  try {
    await logModelRun(record);
  } catch (error) {
    console.warn(
      "Failed to write model run ledger",
      error instanceof Error ? error.message : String(error)
    );
  }
<<<<<<< HEAD
}
=======
}
>>>>>>> c6972ae (init commit)
