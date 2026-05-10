import { REGISTRY } from "../config/registry";
import {
  recordFailure,
  recordSuccess
} from "../storage/modelPerformance";
import { logModelRunSafely } from "../storage/modelRunLedger";
import {
  addTaskContextNote,
  appendTaskOutput,
  buildTaskHandoffMessage,
  completeTaskAttempt,
  createTaskContext,
  loadTaskContext,
  startTaskAttempt,
  type TaskContext
} from "../storage/taskContext";
import { executeModel, executeModelStream } from "./engine";
import { judgeResult } from "./judgeResult";
import { optimizeMessagesForModel } from "./messageOptimizer";
import {
  estimateTokenUsageFromText,
  extractTokenUsage,
  preferActualUsage,
  type NormalizedTokenUsage
} from "./tokenUsage";
import type { ChatStreamChunk } from "../types/provider";

function messageText(messages: any[]): string {
  return messages
    .map((message) => {
      if (typeof message?.content === "string") {
        return message.content;
      }

      return JSON.stringify(message?.content ?? "");
    })
    .join("\n");
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function isThinkingChunk(chunk: ChatStreamChunk): boolean {
  if (chunk.kind === "thinking") {
    return true;
  }

  const rawText = JSON.stringify(chunk.raw ?? "").toLowerCase();

  return (
    rawText.includes("thinking") ||
    rawText.includes("reasoning") ||
    rawText.includes('"phase":"reasoning"') ||
    rawText.includes('"phase":"analysis"')
  );
}

// Heartbeat cadence: how often the router emits a synthetic "thinking"
// keepalive while waiting for the provider to produce output. Defaults to
// 5s; tunable via env. The keepalive resets the downstream client's idle
// timer and gives the user "still working…" feedback instead of silence.
let HEARTBEAT_INTERVAL_MS = Math.max(
  500,
  Number(process.env.STREAM_HEARTBEAT_INTERVAL_MS ?? 5000)
);

// Hard ceiling on how long we'll wait for the provider with zero real
// activity. Independent of heartbeats — only resets when the provider
// itself produces a chunk (content, thinking, or event). This catches
// truly stuck connections where the provider has hung.
let HARD_PROVIDER_SILENCE_MS_DEFAULT = Math.max(
  60_000,
  Number(process.env.STREAM_HARD_SILENCE_MS ?? 600_000)
);

/**
 * Runtime-mutable accessors for the stream timeout settings. Used by the
 * /v1/config endpoint to adjust values without restarting the router.
 */
export function getStreamTimeoutConfig(): {
  heartbeatIntervalMs: number;
  hardSilenceMs: number;
} {
  return {
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    hardSilenceMs: HARD_PROVIDER_SILENCE_MS_DEFAULT
  };
}

export function setStreamTimeoutConfig(opts: {
  heartbeatIntervalMs?: number;
  hardSilenceMs?: number;
}): { heartbeatIntervalMs: number; hardSilenceMs: number } {
  if (opts.heartbeatIntervalMs !== undefined) {
    HEARTBEAT_INTERVAL_MS = Math.max(500, opts.heartbeatIntervalMs);
  }
  if (opts.hardSilenceMs !== undefined) {
    HARD_PROVIDER_SILENCE_MS_DEFAULT = Math.max(60_000, opts.hardSilenceMs);
  }
  return {
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    hardSilenceMs: HARD_PROVIDER_SILENCE_MS_DEFAULT
  };
}

async function* withAdaptiveStreamIdleTimeout<T extends ChatStreamChunk>(
  stream: AsyncIterable<T>,
  normalIdleTimeoutMs: number,
  thinkingIdleTimeoutMs: number,
  label: string
): AsyncIterable<T> {
  const iterator = stream[Symbol.asyncIterator]();

  // The hard ceiling is the larger of the configured per-chunk timeouts and
  // a generous default — provider-silent for this long means it's stuck.
  const hardCeilingMs = Math.max(
    HARD_PROVIDER_SILENCE_MS_DEFAULT,
    thinkingIdleTimeoutMs,
    normalIdleTimeoutMs
  );

  let lastProviderActivityAt = Date.now();
  let lastActivityKind = "start";
  let pendingNext: Promise<IteratorResult<T>> | null = null;

  function nextChunk(): Promise<IteratorResult<T>> {
    if (!pendingNext) {
      pendingNext = iterator.next();
    }
    return pendingNext;
  }

  function makeHeartbeat(): T {
    return {
      content: "",
      kind: "thinking",
      raw: { heartbeat: true, label, lastActivityKind }
    } as unknown as T;
  }

  try {
    while (true) {
      const sinceLastActivity = Date.now() - lastProviderActivityAt;
      if (sinceLastActivity >= hardCeilingMs) {
        throw new Error(
          `${label} stream silent for ${sinceLastActivity}ms (hard ceiling ${hardCeilingMs}ms); last activity: ${lastActivityKind}`
        );
      }

      let heartbeatHandle: NodeJS.Timeout | undefined;
      const heartbeat = new Promise<"heartbeat">((resolve) => {
        heartbeatHandle = setTimeout(() => resolve("heartbeat"), HEARTBEAT_INTERVAL_MS);
      });

      const winner = await Promise.race([nextChunk(), heartbeat]);

      if (heartbeatHandle) {
        clearTimeout(heartbeatHandle);
      }

      if (winner === "heartbeat") {
        // Provider hasn't produced anything since the last heartbeat —
        // emit a synthetic keepalive and keep waiting on the same pending
        // iterator promise. This resets downstream idle timers without
        // touching `lastProviderActivityAt`, so the hard ceiling still bites
        // if the provider is genuinely stuck.
        yield makeHeartbeat();
        continue;
      }

      // Provider produced something — clear the pending promise so the
      // next loop iteration re-arms a fresh `iterator.next()`.
      pendingNext = null;

      if (winner.done) {
        return;
      }

      const chunk = winner.value;
      lastProviderActivityAt = Date.now();
      lastActivityKind = chunk.kind ?? (isThinkingChunk(chunk) ? "thinking" : "content");

      yield chunk;
    }
  } finally {
    if (typeof iterator.return === "function") {
      try {
        await iterator.return();
      } catch {
        // Ignore cleanup errors from provider streams.
      }
    }
  }
}

function getTimeoutForModel(modelKey: string): number {
  const registryEntry = REGISTRY[modelKey as keyof typeof REGISTRY];

  const provider = registryEntry.provider;

  const modelEnvKey = `TIMEOUT_${modelKey.toUpperCase()}_MS`;
  const providerEnvKey = `TIMEOUT_${provider.toUpperCase()}_MS`;

  const modelTimeout = process.env[modelEnvKey];
  const providerTimeout = process.env[providerEnvKey];
  const defaultTimeout = process.env.MODEL_TIMEOUT_MS ?? "30000";

  return Number(modelTimeout ?? providerTimeout ?? defaultTimeout);
}

function getStreamIdleTimeoutForModel(modelKey: string): number {
  const registryEntry = REGISTRY[modelKey as keyof typeof REGISTRY];

  const provider = registryEntry.provider;

  const modelEnvKey = `STREAM_IDLE_TIMEOUT_${modelKey.toUpperCase()}_MS`;
  const providerEnvKey = `STREAM_IDLE_TIMEOUT_${provider.toUpperCase()}_MS`;

  const modelTimeout = process.env[modelEnvKey];
  const providerTimeout = process.env[providerEnvKey];

  const legacyModelTimeout = process.env[`TIMEOUT_${modelKey.toUpperCase()}_MS`];
  const legacyProviderTimeout = process.env[`TIMEOUT_${provider.toUpperCase()}_MS`];

  const defaultTimeout =
    process.env.STREAM_IDLE_TIMEOUT_MS ??
    process.env.MODEL_STREAM_IDLE_TIMEOUT_MS ??
    "30000";

  return Number(
    modelTimeout ??
      providerTimeout ??
      legacyModelTimeout ??
      legacyProviderTimeout ??
      defaultTimeout
  );
}

function getStreamThinkingIdleTimeoutForModel(modelKey: string): number {
  const registryEntry = REGISTRY[modelKey as keyof typeof REGISTRY];

  const provider = registryEntry.provider;

  const modelEnvKey = `STREAM_THINKING_IDLE_TIMEOUT_${modelKey.toUpperCase()}_MS`;
  const providerEnvKey = `STREAM_THINKING_IDLE_TIMEOUT_${provider.toUpperCase()}_MS`;

  const modelTimeout = process.env[modelEnvKey];
  const providerTimeout = process.env[providerEnvKey];

  const defaultTimeout =
    process.env.STREAM_THINKING_IDLE_TIMEOUT_MS ??
    "120000";

  return Number(modelTimeout ?? providerTimeout ?? defaultTimeout);
}

function shouldAttemptStreamingRepair(reason?: string): boolean {
  if (process.env.ENABLE_STREAM_REPAIR === "false") {
    return false;
  }

  if (!reason) {
    return false;
  }

  return [
    "unclosed_code_fence",
    "incomplete_code_shape",
    "incomplete_ending",
    "truncation_marker_or_placeholder"
  ].includes(reason);
}

function buildRepairMessages(
  originalMessages: any[],
  partialOutput: string,
  context?: TaskContext
): any[] {
  const tail = partialOutput.slice(-6000);

  const messages = [...originalMessages];

  if (context) {
    messages.unshift(buildTaskHandoffMessage(context));
  }

  messages.push(
    {
      role: "assistant",
      content: partialOutput
    },
    {
      role: "user",
      content: [
        "The previous assistant response appears to be incomplete or cut off.",
        "",
        "Continue from exactly where it stopped.",
        "Do not restart from the beginning.",
        "Do not repeat content that was already written.",
        "Do not explain.",
        "Do not apologize.",
        "Only output the missing continuation.",
        "",
        "Important context: the last part already sent was:",
        "```text",
        tail,
        "```"
      ].join("\n")
    }
  );

  return messages;
}

function removeLikelyRepeatedPrefix(partialOutput: string, continuation: string): string {
  const trimmedContinuation = continuation.trimStart();

  if (!partialOutput || !trimmedContinuation) {
    return continuation;
  }

  const maxOverlap = Math.min(2000, partialOutput.length, trimmedContinuation.length);

  for (let size = maxOverlap; size >= 20; size--) {
    const suffix = partialOutput.slice(-size);
    const prefix = trimmedContinuation.slice(0, size);

    if (suffix === prefix) {
      return trimmedContinuation.slice(size);
    }
  }

  return continuation;
}

function buildAttemptMessages(
  baseMessages: any[],
  context: TaskContext,
  attemptIndex: number
): any[] {
  if (attemptIndex === 0) {
    return baseMessages;
  }

  return [
    buildTaskHandoffMessage(context),
    ...baseMessages
  ];
}

async function appendOutputSafely(
  context: TaskContext,
  attemptId: string,
  content: string
): Promise<void> {
  try {
    await appendTaskOutput(context, attemptId, content);
  } catch (error) {
    console.warn(
      "Failed to append task context output",
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function completeAttemptSafely(
  context: TaskContext,
  attemptId: string,
  status: "running" | "success" | "failed" | "repaired" | "suspicious",
  message?: string
): Promise<void> {
  try {
    await completeTaskAttempt(context, attemptId, status, message);
  } catch (error) {
    console.warn(
      "Failed to complete task context attempt",
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function logRun(args: {
  requestId: string;
  mode: "chat" | "stream";
  taskType: string;
  modelKey: string;
  status: "success" | "failed" | "rejected" | "suspicious";
  startedAt: number;
  promptText: string;
  outputText: string;
  fallbackIndex: number;
  tokenUsage: NormalizedTokenUsage | null;
  judgeReason?: string;
  error?: string;
}): Promise<void> {
  const profile = REGISTRY[args.modelKey as keyof typeof REGISTRY];

  await logModelRunSafely({
    requestId: args.requestId,
    mode: args.mode,
    taskType: args.taskType,
    modelKey: args.modelKey,
    provider: profile.provider,
    providerModel: profile.id,
    status: args.status,
    latencyMs: Date.now() - args.startedAt,
    tokenUsage:
      args.tokenUsage ??
      estimateTokenUsageFromText({
        promptText: args.promptText,
        outputText: args.outputText,
        source: `estimated_${args.mode}_chars_div_4`
      }),
    fallbackIndex: args.fallbackIndex,
    judgeReason: args.judgeReason,
    error: args.error,
    inputChars: args.promptText.length,
    outputChars: args.outputText.length
  });
}

export async function executeChain(
  chain: string[],
  messages: any[],
  taskType: string,
  options: { previousRequestId?: string } = {}
) {
  let lastError: unknown;

  const attemptedModels = new Set<string>();

  // If the caller hands us a previous task context, prepend its handoff message
  // so the next agent sees what already happened across requests.
  let effectiveMessages = messages;
  if (options.previousRequestId) {
    const prev = await loadTaskContext(options.previousRequestId);
    if (prev) {
      effectiveMessages = [buildTaskHandoffMessage(prev), ...messages];
      console.log(
        `Cross-request handoff: prepending context from ${options.previousRequestId}`
      );
    } else {
      console.warn(
        `Cross-request handoff requested but ${options.previousRequestId} not found`
      );
    }
  }

  const promptText = messageText(effectiveMessages);

  const context = await createTaskContext({
    taskType,
    originalMessages: effectiveMessages
  });

  console.log(`Task context: ${context.requestId}`);

  for (let attemptIndex = 0; attemptIndex < chain.length; attemptIndex++) {
    const modelKey = chain[attemptIndex]!;

    if (attemptedModels.has(modelKey)) {
      console.warn(`Skipping duplicate fallback model: ${modelKey}`);
      continue;
    }

    attemptedModels.add(modelKey);

    const attempt = await startTaskAttempt(context, modelKey);
    const startedAt = Date.now();

    try {
      const timeoutMs = getTimeoutForModel(modelKey);

      console.log(
        `Trying model: ${modelKey} (timeout: ${timeoutMs}ms, context: ${context.requestId})`
      );

      const attemptMessages = buildAttemptMessages(
        effectiveMessages,
        context,
        attemptIndex
      );

      const optimizedMessages = optimizeMessagesForModel(
        modelKey,
        attemptMessages
      );

      const result = await withTimeout(
        executeModel(modelKey as any, optimizedMessages, { promptCache: true }),
        timeoutMs,
        modelKey
      );

      await appendOutputSafely(context, attempt.attemptId, result.content);

      let tokenUsage = extractTokenUsage(result.raw);
      let verdict = judgeResult(promptText, result.content);

      if (!verdict.pass && shouldAttemptStreamingRepair(verdict.reason)) {
        console.warn(
          `Model output needs repair: ${modelKey} — ${verdict.reason}`
        );

        await addTaskContextNote(
          context,
          `Non-streaming repair started because judge returned ${verdict.reason}`,
          modelKey,
          attempt.attemptId
        );

        const repairMessages = optimizeMessagesForModel(
          modelKey,
          buildRepairMessages(effectiveMessages, result.content, context)
        );

        const repairResult = await withTimeout(
          executeModel(modelKey as any, repairMessages, { promptCache: true }),
          timeoutMs,
          `${modelKey}:repair`
        );

        tokenUsage = preferActualUsage(tokenUsage, extractTokenUsage(repairResult.raw));

        const continuation = removeLikelyRepeatedPrefix(
          result.content,
          repairResult.content
        );

        result.content = `${result.content}${continuation}`;

        await appendOutputSafely(context, attempt.attemptId, continuation);

        verdict = judgeResult(promptText, result.content);
      }

      if (!verdict.pass) {
        console.warn(
          `Model rejected by judge: ${modelKey} — ${verdict.reason}`
        );

        await completeAttemptSafely(
          context,
          attempt.attemptId,
          "suspicious",
          verdict.reason
        );

        await logRun({
          requestId: context.requestId,
          mode: "chat",
          taskType,
          modelKey,
          status: "rejected",
          startedAt,
          promptText,
          outputText: result.content,
          fallbackIndex: attemptIndex,
          tokenUsage,
          judgeReason: verdict.reason
        });

        recordFailure(modelKey, taskType);
        continue;
      }

      await completeAttemptSafely(context, attempt.attemptId, "success");

      await logRun({
        requestId: context.requestId,
        mode: "chat",
        taskType,
        modelKey,
        status: "success",
        startedAt,
        promptText,
        outputText: result.content,
        fallbackIndex: attemptIndex,
        tokenUsage
      });

      recordSuccess(modelKey, taskType);

      return {
        result,
        usedModel: modelKey,
        taskContextId: context.requestId
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      console.warn(`Model failed: ${modelKey}`, message);

      await completeAttemptSafely(
        context,
        attempt.attemptId,
        "failed",
        message
      );

      await logRun({
        requestId: context.requestId,
        mode: "chat",
        taskType,
        modelKey,
        status: "failed",
        startedAt,
        promptText,
        outputText: "",
        fallbackIndex: attemptIndex,
        tokenUsage: null,
        error: message
      });

      recordFailure(modelKey, taskType);
      lastError = err;
    }
  }

  throw new Error(
    `All fallback models failed. Last error: ${
      lastError instanceof Error
        ? lastError.message
        : String(lastError)
    }`
  );
}

export async function* executeChainStream(
  chain: string[],
  messages: any[],
  taskType: string,
  options: { previousRequestId?: string } = {}
): AsyncIterable<ChatStreamChunk & { usedModel: string; taskContextId?: string }> {
  let lastError: unknown;

  const attemptedModels = new Set<string>();

  let effectiveMessages = messages;
  if (options.previousRequestId) {
    const prev = await loadTaskContext(options.previousRequestId);
    if (prev) {
      effectiveMessages = [buildTaskHandoffMessage(prev), ...messages];
      console.log(
        `Cross-request handoff (stream): prepending context from ${options.previousRequestId}`
      );
    } else {
      console.warn(
        `Cross-request handoff (stream) requested but ${options.previousRequestId} not found`
      );
    }
  }

  const promptText = messageText(effectiveMessages);

  const maxRepairs = Number(process.env.STREAM_REPAIR_MAX_ATTEMPTS ?? 1);

  const context = await createTaskContext({
    taskType,
    originalMessages: effectiveMessages
  });

  console.log(`Task context: ${context.requestId}`);

  for (let attemptIndex = 0; attemptIndex < chain.length; attemptIndex++) {
    const modelKey = chain[attemptIndex]!;

    if (attemptedModels.has(modelKey)) {
      console.warn(`Skipping duplicate streaming fallback model: ${modelKey}`);
      continue;
    }

    attemptedModels.add(modelKey);

    const attempt = await startTaskAttempt(context, modelKey);

    const startedAt = Date.now();
    let streamedAnyChunk = false;
    let collected = "";
    let tokenUsage: NormalizedTokenUsage | null = null;

    try {
      const normalIdleTimeoutMs = getStreamIdleTimeoutForModel(modelKey);
      const thinkingIdleTimeoutMs = getStreamThinkingIdleTimeoutForModel(modelKey);

      console.log(
        `Trying streaming model: ${modelKey} (idle timeout: ${normalIdleTimeoutMs}ms, thinking idle timeout: ${thinkingIdleTimeoutMs}ms, context: ${context.requestId})`
      );

      const attemptMessages = buildAttemptMessages(
        effectiveMessages,
        context,
        attemptIndex
      );

      const optimizedMessages = optimizeMessagesForModel(
        modelKey,
        attemptMessages
      );

      const stream = withAdaptiveStreamIdleTimeout(
        executeModelStream(modelKey as any, optimizedMessages, { promptCache: true }),
        normalIdleTimeoutMs,
        thinkingIdleTimeoutMs,
        modelKey
      );

      for await (const chunk of stream) {
        tokenUsage = preferActualUsage(tokenUsage, extractTokenUsage(chunk.raw));

        if (chunk.kind === "thinking") {
          await addTaskContextNote(
            context,
            "Provider emitted thinking/reasoning activity",
            modelKey,
            attempt.attemptId
          );
          continue;
        }

        if (!chunk.content) {
          continue;
        }

        streamedAnyChunk = true;
        collected += chunk.content;

        await appendOutputSafely(context, attempt.attemptId, chunk.content);

        yield {
          ...chunk,
          usedModel: modelKey,
          taskContextId: context.requestId
        };
      }

      let verdict = judgeResult(promptText, collected);

      if (!verdict.pass && !streamedAnyChunk) {
        console.warn(
          `Streaming model rejected before output: ${modelKey} — ${verdict.reason}`
        );

        await completeAttemptSafely(
          context,
          attempt.attemptId,
          "suspicious",
          verdict.reason
        );

        await logRun({
          requestId: context.requestId,
          mode: "stream",
          taskType,
          modelKey,
          status: "rejected",
          startedAt,
          promptText,
          outputText: collected,
          fallbackIndex: attemptIndex,
          tokenUsage,
          judgeReason: verdict.reason
        });

        recordFailure(modelKey, taskType);
        continue;
      }

      let repairAttempt = 0;

      while (
        !verdict.pass &&
        shouldAttemptStreamingRepair(verdict.reason) &&
        repairAttempt < maxRepairs
      ) {
        repairAttempt += 1;

        console.warn(
          `Streaming model needs repair: ${modelKey} — ${verdict.reason} (attempt ${repairAttempt}/${maxRepairs})`
        );

        await addTaskContextNote(
          context,
          `Streaming repair attempt ${repairAttempt}/${maxRepairs} because judge returned ${verdict.reason}`,
          modelKey,
          attempt.attemptId
        );

        const repairMessages = optimizeMessagesForModel(
          modelKey,
          buildRepairMessages(effectiveMessages, collected, context)
        );

        let repairCollected = "";

        const repairStream = withAdaptiveStreamIdleTimeout(
          executeModelStream(modelKey as any, repairMessages, { promptCache: true }),
          normalIdleTimeoutMs,
          thinkingIdleTimeoutMs,
          `${modelKey}:repair`
        );

        for await (const chunk of repairStream) {
          tokenUsage = preferActualUsage(tokenUsage, extractTokenUsage(chunk.raw));

          if (chunk.kind === "thinking") {
            await addTaskContextNote(
              context,
              "Repair provider emitted thinking/reasoning activity",
              modelKey,
              attempt.attemptId
            );
            continue;
          }

          if (!chunk.content) {
            continue;
          }

          repairCollected += chunk.content;
        }

        const continuation = removeLikelyRepeatedPrefix(
          collected,
          repairCollected
        );

        if (!continuation.trim()) {
          console.warn(
            `Streaming repair produced empty continuation: ${modelKey}`
          );

          await addTaskContextNote(
            context,
            "Streaming repair produced empty continuation",
            modelKey,
            attempt.attemptId
          );

          break;
        }

        collected += continuation;

        await appendOutputSafely(context, attempt.attemptId, continuation);

        yield {
          content: continuation,
          kind: "content",
          raw: {
            repair: true,
            attempt: repairAttempt,
            modelKey,
            taskContextId: context.requestId
          },
          usedModel: modelKey,
          taskContextId: context.requestId
        };

        verdict = judgeResult(promptText, collected);
      }

      if (!verdict.pass) {
        console.warn(
          `Streaming model produced suspicious output after repair: ${modelKey} — ${verdict.reason}`
        );

        await completeAttemptSafely(
          context,
          attempt.attemptId,
          "suspicious",
          verdict.reason
        );

        await logRun({
          requestId: context.requestId,
          mode: "stream",
          taskType,
          modelKey,
          status: "suspicious",
          startedAt,
          promptText,
          outputText: collected,
          fallbackIndex: attemptIndex,
          tokenUsage,
          judgeReason: verdict.reason
        });

        recordFailure(modelKey, taskType);
        return;
      }

      await completeAttemptSafely(context, attempt.attemptId, "success");

      await logRun({
        requestId: context.requestId,
        mode: "stream",
        taskType,
        modelKey,
        status: "success",
        startedAt,
        promptText,
        outputText: collected,
        fallbackIndex: attemptIndex,
        tokenUsage
      });

      recordSuccess(modelKey, taskType);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      console.warn(`Streaming model failed: ${modelKey}`, message);

      await completeAttemptSafely(
        context,
        attempt.attemptId,
        "failed",
        message
      );

      await logRun({
        requestId: context.requestId,
        mode: "stream",
        taskType,
        modelKey,
        status: "failed",
        startedAt,
        promptText,
        outputText: collected,
        fallbackIndex: attemptIndex,
        tokenUsage,
        error: message
      });

      recordFailure(modelKey, taskType);
      lastError = err;

      if (streamedAnyChunk) {
        throw err;
      }
    }
  }

  throw new Error(
    `All streaming fallback models failed. Last error: ${
      lastError instanceof Error
        ? lastError.message
        : String(lastError)
    }`
  );
}
