import "dotenv/config";
import express from "express";
import cors from "cors";
import { selectModel } from "./router/selectModel";
import { incrementUsage } from "./storage/usageLedger";
import {
  executeChain,
  getStreamTimeoutConfig,
  setStreamTimeoutConfig
} from "./router/executeChain";
import {
  sanitizeAssistantContent,
  sanitizeAssistantStream
} from "./router/outputSanitizer";
import { startTask, subscribe, getTaskStatus } from "./router/taskBroker";

const app = express();

app.use(cors());
app.use(express.json({ limit: "25mb" }));

function createChatCompletionId(): string {
  return `chatcmpl_${Date.now()}`;
}

function writeSse(res: express.Response, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "cline-model-router" });
});

app.get("/v1/config", (_req, res) => {
  res.json(getStreamTimeoutConfig());
});

app.put("/v1/config", (req, res) => {
  const { heartbeatIntervalMs, hardSilenceMs } = req.body ?? {};
  const updated = setStreamTimeoutConfig({ heartbeatIntervalMs, hardSilenceMs });
  res.json(updated);
});

app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: "auto-cline-balanced",
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "cline-model-router"
      },
      {
        id: "auto-cline-fast",
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "cline-model-router"
      },
      {
        id: "auto-cline-free-first",
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "cline-model-router"
      },
      {
        id: "auto-cline-deep",
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "cline-model-router"
      }
    ]
  });
});

app.post("/v1/chat/completions", async (req, res) => {
  try {
    const messages = req.body.messages ?? [];
    const stream = Boolean(req.body.stream);

    const headerPrev = req.headers["x-codemakk-previous-request-id"];
    const previousRequestId =
      (typeof headerPrev === "string" ? headerPrev : undefined) ??
      (typeof req.body.previousRequestId === "string"
        ? req.body.previousRequestId
        : undefined);

    const decision = selectModel({
      ...req.body,
      _headers: req.headers
    });

    if (!stream) {
      const execution = await executeChain(
        decision.fallbackChain,
        messages,
        decision.task.taskType,
        { previousRequestId }
      );

      const rawContent = execution.result.content ?? "";
      const cleanedContent = sanitizeAssistantContent(rawContent, messages);

      incrementUsage(execution.usedModel);

      res.setHeader("x-codemakk-task-context-id", execution.taskContextId);

      return res.json({
        id: createChatCompletionId(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: execution.usedModel,
        router: {
          requestedModel: req.body.model,
          usedModel: execution.usedModel,
          taskContextId: execution.taskContextId
        },
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: cleanedContent
            },
            finish_reason: "stop"
          }
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    // Kick off the task in the broker. It runs to completion regardless of
    // whether this HTTP client stays connected — that's how mid-stream
    // disconnects become recoverable: the CLI can reattach via
    // GET /v1/tasks/:id/stream and pick up where it left off.
    const { taskContextIdPromise } = startTask({
      messages,
      decision,
      taskType: decision.task.taskType,
      previousRequestId
    });

    // Surface the taskContextId as a header as soon as we know it, so the
    // CLI can capture it even if the connection drops before the first SSE
    // chunk arrives. We can't await before flushHeaders, but we can race
    // and emit a synthetic SSE event.
    void taskContextIdPromise.then((id) => {
      try {
        writeSse(res, {
          id: createChatCompletionId(),
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: req.body.model,
          router: {
            requestedModel: req.body.model,
            taskContextId: id,
            taskHandshake: true
          },
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: null
            }
          ]
        });
      } catch {
        // client may have disconnected — broker keeps running
      }
    });

    const taskContextId = await taskContextIdPromise.catch(() => null);

    if (!taskContextId) {
      writeSse(res, {
        error: { message: "Task failed to start", type: "router_error" }
      });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    await streamTaskToHttp({
      taskContextId,
      afterChunkId: 0,
      req,
      res,
      messages,
      requestedModel: req.body.model
    });
  } catch (err) {
    console.error(err);

    if (res.headersSent) {
      writeSse(res, {
        error: {
          message:
            err instanceof Error
              ? err.message
              : "Unknown router stream error",
          type: "router_error"
        }
      });

      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.status(500).json({
      error: {
        message:
          err instanceof Error
            ? err.message
            : "Unknown router error",
        type: "router_error"
      }
    });
  }
});

/**
 * Pump a task's chunks (via the broker) into an SSE response. Used by both
 * the initial POST /v1/chat/completions stream and the resume endpoint
 * GET /v1/tasks/:id/stream. Sanitization is applied so client-visible
 * deltas match the existing OpenAI-compat shape.
 */
async function streamTaskToHttp(args: {
  taskContextId: string;
  afterChunkId: number;
  req: express.Request;
  res: express.Response;
  messages: any[];
  requestedModel?: string | undefined;
}): Promise<void> {
  const { taskContextId, afterChunkId, req, res, messages, requestedModel } =
    args;

  const abortController = new AbortController();
  const onClose = (): void => abortController.abort();
  req.on("close", onClose);

  let usedModel: string | null = null;
  let endedKind: "completed" | "error" | "client-disconnect" | null = null;
  let lastChunkId = afterChunkId;
  function setEnded(kind: typeof endedKind): void {
    endedKind = kind;
  }

  const broker = subscribe({
    taskContextId,
    afterChunkId,
    signal: abortController.signal
  });

  // Adapt LoggedChunks → {content} stream for the sanitizer, while
  // tracking the latest chunkId out-of-band so SSE events can include it.
  // Heartbeats and end-markers don't go through the sanitizer.
  type SanitizerInput = {
    content: string;
    chunkId: number;
    usedModel?: string | undefined;
  };
  const sanitizerInput = (async function* (): AsyncIterable<SanitizerInput> {
    for await (const chunk of broker) {
      lastChunkId = chunk.chunkId;
      if (chunk.usedModel) usedModel = chunk.usedModel;

      if (chunk.kind === "heartbeat") {
        // Emit a no-op SSE chunk so the client's idle timer resets and the
        // user sees the connection is alive.
        try {
          writeSse(res, {
            id: createChatCompletionId(),
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: usedModel ?? requestedModel,
            router: {
              requestedModel,
              usedModel,
              taskContextId,
              chunkId: chunk.chunkId,
              heartbeat: true
            },
            choices: [{ index: 0, delta: {}, finish_reason: null }]
          });
        } catch {
          // res may be closed
        }
        continue;
      }

      if (chunk.kind === "completed") {
        setEnded("completed");
        return;
      }

      if (chunk.kind === "error") {
        setEnded("error");
        return;
      }

      if (chunk.content) {
        yield {
          content: chunk.content,
          chunkId: chunk.chunkId,
          usedModel: chunk.usedModel
        };
      }
    }
  })();

  try {
    // sanitizeAssistantStream yields strings, but we lose chunkId visibility
    // through it. We accept that — chunkId on each SSE chunk reflects the
    // most recent broker chunk we saw, which is sufficient for resume.
    for await (const content of sanitizeAssistantStream(sanitizerInput, messages)) {
      if (!content) continue;
      try {
        writeSse(res, {
          id: createChatCompletionId(),
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: usedModel ?? requestedModel,
          router: {
            requestedModel,
            usedModel,
            taskContextId,
            chunkId: lastChunkId
          },
          choices: [
            { index: 0, delta: { content }, finish_reason: null }
          ]
        });
      } catch {
        setEnded("client-disconnect");
        return;
      }
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      try {
        writeSse(res, {
          error: {
            message: err instanceof Error ? err.message : String(err),
            type: "router_error"
          }
        });
      } catch {
        // ignore
      }
    }
    setEnded("error");
  } finally {
    req.off("close", onClose);

    if (endedKind === "completed") {
      if (usedModel) incrementUsage(usedModel);
      try {
        writeSse(res, {
          id: createChatCompletionId(),
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: usedModel ?? requestedModel,
          router: {
            requestedModel,
            usedModel,
            taskContextId,
            chunkId: lastChunkId
          },
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
        });
        res.write("data: [DONE]\n\n");
        res.end();
      } catch {
        // ignore
      }
    } else if (endedKind === "error") {
      try {
        res.write("data: [DONE]\n\n");
        res.end();
      } catch {
        // ignore
      }
    }
    // For client-disconnect, the response is already gone; the broker keeps
    // running and the next subscriber can resume from lastChunkId.
  }
}

/**
 * Resume an in-flight or recently-completed task. Same SSE shape as
 * /v1/chat/completions stream, just a different way of attaching.
 */
app.get("/v1/tasks/:taskContextId/stream", async (req, res) => {
  const taskContextId = req.params.taskContextId;
  const afterChunkId = Math.max(0, Number(req.query.afterChunkId ?? 0));

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  await streamTaskToHttp({
    taskContextId,
    afterChunkId,
    req,
    res,
    messages: [],
    requestedModel: undefined
  });
});

/**
 * Lightweight status endpoint. Returns whether the task is still running,
 * the last chunkId emitted, and any terminal error. CLI uses this to decide
 * whether reconnecting is worthwhile.
 */
app.get("/v1/tasks/:taskContextId/status", (req, res) => {
  const status = getTaskStatus(req.params.taskContextId);
  res.json({ taskContextId: req.params.taskContextId, ...status });
});

const port = Number(process.env.PORT ?? 8787);

app.listen(port, () => {
  console.log(`Cline model router listening on http://localhost:${port}`);
});
