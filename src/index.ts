import "dotenv/config";
import express from "express";
import cors from "cors";
import { selectModel } from "./router/selectModel";
import { incrementUsage } from "./storage/usageLedger";
import { executeChain, executeChainStream } from "./router/executeChain";
import {
  sanitizeAssistantContent,
  sanitizeAssistantStream
} from "./router/outputSanitizer";

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

    const decision = selectModel({
      ...req.body,
      _headers: req.headers
    });

    if (!stream) {
      const execution = await executeChain(
        decision.fallbackChain,
        messages,
        decision.task.taskType
      );

      const rawContent = execution.result.content ?? "";
      const cleanedContent = sanitizeAssistantContent(rawContent, messages);

      incrementUsage(execution.usedModel);

      return res.json({
        id: createChatCompletionId(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: execution.usedModel,
        router: {
          requestedModel: req.body.model,
          usedModel: execution.usedModel
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

    let usedModel: string | null = null;

    const rawStream = executeChainStream(
      decision.fallbackChain,
      messages,
      decision.task.taskType
    );

    async function* contentStream() {
      for await (const chunk of rawStream) {
        usedModel = chunk.usedModel;
        yield chunk;
      }
    }

    for await (const content of sanitizeAssistantStream(contentStream(), messages)) {
      if (!content) {
        continue;
      }

      writeSse(res, {
        id: createChatCompletionId(),
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: usedModel ?? req.body.model,
        router: {
          requestedModel: req.body.model,
          usedModel
        },
        choices: [
          {
            index: 0,
            delta: {
              content
            },
            finish_reason: null
          }
        ]
      });
    }

    if (usedModel) {
      incrementUsage(usedModel);
    }

    writeSse(res, {
      id: createChatCompletionId(),
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: usedModel ?? req.body.model,
      router: {
        requestedModel: req.body.model,
        usedModel
      },
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "stop"
        }
      ]
    });

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error(err);

    if (res.headersSent) {
      writeSse(res, {
        error: {
          message: err instanceof Error ? err.message : "Unknown router stream error",
          type: "router_error"
        }
      });

      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.status(500).json({
      error: {
        message: err instanceof Error ? err.message : "Unknown router error",
        type: "router_error"
      }
    });
  }
});

const port = Number(process.env.PORT ?? 8787);

app.listen(port, () => {
  console.log(`Cline model router listening on http://localhost:${port}`);
});
