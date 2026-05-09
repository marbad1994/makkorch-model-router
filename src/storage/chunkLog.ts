import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

import type { ChatStreamChunkKind } from "../types/provider";

export type LoggedChunk = {
  chunkId: number;
  timestamp: number;
  kind: ChatStreamChunkKind | "heartbeat" | "error" | "completed";
  content: string;
  usedModel?: string;
  meta?: Record<string, unknown>;
};

const DEFAULT_DIR = path.join(process.cwd(), "data", "task-chunks");

function chunkDir(): string {
  return process.env.TASK_CHUNK_DIR ?? DEFAULT_DIR;
}

function chunkPath(taskId: string): string {
  return path.join(chunkDir(), `${taskId}.jsonl`);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(chunkDir(), { recursive: true });
}

export async function appendChunk(taskId: string, chunk: LoggedChunk): Promise<void> {
  if (process.env.ENABLE_TASK_CHUNK_LOG === "false") {
    return;
  }
  await ensureDir();
  await fs.appendFile(chunkPath(taskId), JSON.stringify(chunk) + "\n", "utf8");
}

/**
 * Stream chunks from disk after a given chunkId (exclusive). Returns an async
 * generator so callers can pipe straight to SSE. Tolerates missing files
 * (returns nothing) and partially-written final lines (skips them).
 */
export async function* readChunksAfter(
  taskId: string,
  afterChunkId: number
): AsyncIterable<LoggedChunk> {
  const filePath = chunkPath(taskId);
  try {
    await fs.access(filePath);
  } catch {
    return;
  }

  const fileStream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: fileStream, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      if (!line) continue;
      let parsed: LoggedChunk | null = null;
      try {
        parsed = JSON.parse(line) as LoggedChunk;
      } catch {
        continue;
      }
      if (!parsed) continue;
      if (parsed.chunkId <= afterChunkId) continue;
      yield parsed;
    }
  } finally {
    lines.close();
    fileStream.close();
  }
}

export async function readLastChunkId(taskId: string): Promise<number> {
  let last = 0;
  for await (const chunk of readChunksAfter(taskId, -1)) {
    if (chunk.chunkId > last) last = chunk.chunkId;
  }
  return last;
}
