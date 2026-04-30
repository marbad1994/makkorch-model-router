import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export type TaskAttemptStatus =
  | "running"
  | "success"
  | "failed"
  | "repaired"
  | "suspicious";

export type TaskContextAttempt = {
  attemptId: string;
  modelKey: string;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  status: TaskAttemptStatus;
  failureReason?: string;
  outputChars: number;
  outputPreview?: string;
  outputTail?: string;
};

export type TaskContextEvent = {
  timestamp: number;
  type:
    | "task_started"
    | "attempt_started"
    | "stream_delta"
    | "attempt_completed"
    | "attempt_failed"
    | "repair_started"
    | "repair_completed"
    | "judge_rejection"
    | "note";
  modelKey?: string;
  attemptId?: string;
  message?: string;
  chars?: number;
};

export type TaskContext = {
  requestId: string;
  createdAt: number;
  updatedAt: number;
  taskType: string;
  originalMessages: any[];
  attempts: TaskContextAttempt[];
  currentOutput: string;
  events: TaskContextEvent[];
};

const DEFAULT_CONTEXT_DIR = path.join(process.cwd(), "data", "task-context");
const MAX_CURRENT_OUTPUT_CHARS = Number(
  process.env.TASK_CONTEXT_MAX_OUTPUT_CHARS ?? 24000
);
const MAX_EVENT_COUNT = Number(process.env.TASK_CONTEXT_MAX_EVENTS ?? 300);
const OUTPUT_PREVIEW_CHARS = Number(
  process.env.TASK_CONTEXT_OUTPUT_PREVIEW_CHARS ?? 1200
);
const OUTPUT_TAIL_CHARS = Number(process.env.TASK_CONTEXT_OUTPUT_TAIL_CHARS ?? 8000);

function now(): number {
  return Date.now();
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function contextDir(): string {
  return process.env.TASK_CONTEXT_DIR ?? DEFAULT_CONTEXT_DIR;
}

function contextPath(requestId: string): string {
  return path.join(contextDir(), `${requestId}.json`);
}

function clampTail(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(value.length - maxChars);
}

function clampHead(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(0, maxChars);
}

function trimContext(context: TaskContext): TaskContext {
  context.currentOutput = clampTail(context.currentOutput, MAX_CURRENT_OUTPUT_CHARS);

  if (context.events.length > MAX_EVENT_COUNT) {
    context.events = context.events.slice(context.events.length - MAX_EVENT_COUNT);
  }

  for (const attempt of context.attempts) {
    if (attempt.outputPreview) {
      attempt.outputPreview = clampHead(attempt.outputPreview, OUTPUT_PREVIEW_CHARS);
    }

    if (attempt.outputTail) {
      attempt.outputTail = clampTail(attempt.outputTail, OUTPUT_TAIL_CHARS);
    }
  }

  return context;
}

async function ensureContextDir(): Promise<void> {
  await fs.mkdir(contextDir(), { recursive: true });
}

export async function saveTaskContext(context: TaskContext): Promise<void> {
  if (process.env.ENABLE_TASK_CONTEXT === "false") {
    return;
  }

  await ensureContextDir();

  const trimmed = trimContext({
    ...context,
    updatedAt: now()
  });

  await fs.writeFile(
    contextPath(context.requestId),
    JSON.stringify(trimmed, null, 2),
    "utf8"
  );
}

export async function loadTaskContext(requestId: string): Promise<TaskContext | null> {
  try {
    const raw = await fs.readFile(contextPath(requestId), "utf8");
    return JSON.parse(raw) as TaskContext;
  } catch {
    return null;
  }
}

export async function createTaskContext(args: {
  taskType: string;
  originalMessages: any[];
}): Promise<TaskContext> {
  const timestamp = now();

  const context: TaskContext = {
    requestId: makeId("task"),
    createdAt: timestamp,
    updatedAt: timestamp,
    taskType: args.taskType,
    originalMessages: args.originalMessages,
    attempts: [],
    currentOutput: "",
    events: [
      {
        timestamp,
        type: "task_started",
        message: `Task started as ${args.taskType}`
      }
    ]
  };

  await saveTaskContext(context);
  return context;
}

export async function startTaskAttempt(
  context: TaskContext,
  modelKey: string
): Promise<TaskContextAttempt> {
  const timestamp = now();

  const attempt: TaskContextAttempt = {
    attemptId: makeId("attempt"),
    modelKey,
    startedAt: timestamp,
    updatedAt: timestamp,
    status: "running",
    outputChars: 0,
    outputPreview: "",
    outputTail: ""
  };

  context.attempts.push(attempt);
  context.events.push({
    timestamp,
    type: "attempt_started",
    modelKey,
    attemptId: attempt.attemptId,
    message: `Attempt started with ${modelKey}`
  });

  await saveTaskContext(context);
  return attempt;
}

export async function appendTaskOutput(
  context: TaskContext,
  attemptId: string,
  content: string
): Promise<void> {
  if (!content) {
    return;
  }

  const timestamp = now();

  context.currentOutput += content;
  context.currentOutput = clampTail(context.currentOutput, MAX_CURRENT_OUTPUT_CHARS);

  const attempt = context.attempts.find((item) => item.attemptId === attemptId);

  if (attempt) {
    attempt.updatedAt = timestamp;
    attempt.outputChars += content.length;
    attempt.outputPreview = clampHead(
      `${attempt.outputPreview ?? ""}${content}`,
      OUTPUT_PREVIEW_CHARS
    );
    attempt.outputTail = clampTail(
      `${attempt.outputTail ?? ""}${content}`,
      OUTPUT_TAIL_CHARS
    );
  }

  context.events.push({
    timestamp,
    type: "stream_delta",
    modelKey: attempt?.modelKey,
    attemptId,
    chars: content.length
  });

  await saveTaskContext(context);
}

export async function completeTaskAttempt(
  context: TaskContext,
  attemptId: string,
  status: TaskAttemptStatus,
  message?: string
): Promise<void> {
  const timestamp = now();

  const attempt = context.attempts.find((item) => item.attemptId === attemptId);

  if (attempt) {
    attempt.status = status;
    attempt.updatedAt = timestamp;
    attempt.endedAt = timestamp;

    if (status === "failed" || status === "suspicious") {
      attempt.failureReason = message;
    }
  }

  context.events.push({
    timestamp,
    type:
      status === "success"
        ? "attempt_completed"
        : status === "repaired"
          ? "repair_completed"
          : status === "suspicious"
            ? "judge_rejection"
            : "attempt_failed",
    modelKey: attempt?.modelKey,
    attemptId,
    message
  });

  await saveTaskContext(context);
}

export async function addTaskContextNote(
  context: TaskContext,
  message: string,
  modelKey?: string,
  attemptId?: string
): Promise<void> {
  context.events.push({
    timestamp: now(),
    type: "note",
    modelKey,
    attemptId,
    message
  });

  await saveTaskContext(context);
}

export function buildTaskHandoffMessage(context: TaskContext): any {
  const failedAttempts = context.attempts.filter(
    (attempt) => attempt.status === "failed" || attempt.status === "suspicious"
  );

  const lastAttempt = context.attempts.at(-1);
  const lastEvents = context.events.slice(-20);

  const attemptSummary = context.attempts
    .map((attempt, index) => {
      return [
        `Attempt ${index + 1}:`,
        `- model: ${attempt.modelKey}`,
        `- status: ${attempt.status}`,
        `- output chars: ${attempt.outputChars}`,
        attempt.failureReason
          ? `- failure/rejection reason: ${attempt.failureReason}`
          : ""
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const failureSummary =
    failedAttempts.length > 0
      ? failedAttempts
          .map((attempt) => {
            return `- ${attempt.modelKey}: ${attempt.failureReason ?? attempt.status}`;
          })
          .join("\n")
      : "- none yet";

  const eventSummary = lastEvents
    .map((event) => {
      const model = event.modelKey ? ` ${event.modelKey}` : "";
      const msg = event.message ? ` — ${event.message}` : "";
      const chars = event.chars ? ` (${event.chars} chars)` : "";
      return `- ${event.type}${model}${chars}${msg}`;
    })
    .join("\n");

  const outputTail =
    lastAttempt?.outputTail ?? context.currentOutput.slice(-OUTPUT_TAIL_CHARS);

  return {
    role: "system",
    content: [
      "Router handoff context for this task:",
      "",
      "A previous model attempt may have failed, timed out, produced suspicious output, or been interrupted.",
      "Use this context to continue intelligently instead of starting blind.",
      "",
      `Task type: ${context.taskType}`,
      `Task context id: ${context.requestId}`,
      "",
      "Attempt summary:",
      attemptSummary || "- no attempts yet",
      "",
      "Failures/rejections:",
      failureSummary,
      "",
      "Recent router events:",
      eventSummary || "- no events",
      "",
      "Latest partial output tail:",
      "```text",
      outputTail || "(no partial output captured)",
      "```",
      "",
      "Instructions for the next model:",
      "- Continue the user's original task.",
      "- If the partial output is usable, continue from where it stopped.",
      "- If the partial output is broken, repair it and produce the correct final answer.",
      "- Do not repeat large sections that were already completed unless needed for correctness.",
      "- For code generation, prefer complete files and avoid placeholders."
    ].join("\n")
  };
}
