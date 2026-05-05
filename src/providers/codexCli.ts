import { spawn } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type {
  Provider,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk
} from "../types/provider";

type JsonRpcId = string | number;

type JsonRpcRequest = {
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

type JsonRpcMessage = {
  id?: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  method?: string;
  params?: unknown;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type CodexModel = {
  id: string;
  model: string;
  displayName?: string;
  hidden?: boolean;
  isDefault?: boolean;
  defaultReasoningEffort?: string;
};

type CodexTurnResult = {
  content: string;
  rawContent: string;
  rawEvents: JsonRpcMessage[];
  tokenUsage?: unknown;
  selectedModel: string;
  threadId?: string;
  turnId?: string;
};

class AsyncChunkQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiting:
    | {
        resolve: (value: IteratorResult<T>) => void;
        reject: (reason?: unknown) => void;
      }
    | undefined;

  private done = false;
  private failure: unknown;

  push(value: T): void {
    if (this.done) {
      return;
    }

    if (this.waiting) {
      const waiter = this.waiting;
      this.waiting = undefined;
      waiter.resolve({ value, done: false });
      return;
    }

    this.values.push(value);
  }

  end(): void {
    if (this.done) {
      return;
    }

    this.done = true;

    if (this.waiting) {
      const waiter = this.waiting;
      this.waiting = undefined;
      waiter.resolve({
        value: undefined as T,
        done: true
      });
    }
  }

  throw(error: unknown): void {
    if (this.done) {
      return;
    }

    this.done = true;
    this.failure = error;

    if (this.waiting) {
      const waiter = this.waiting;
      this.waiting = undefined;
      waiter.reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({
            value: this.values.shift()!,
            done: false
          });
        }

        if (this.failure) {
          return Promise.reject(this.failure);
        }

        if (this.done) {
          return Promise.resolve({
            value: undefined as T,
            done: true
          });
        }

        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiting = { resolve, reject };
        });
      }
    };
  }
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  return JSON.stringify(content);
}

function getLastUserMessage(messages: ChatRequest["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    if (message?.role === "user") {
      return stringifyMessageContent(message.content).trim();
    }
  }

  return "";
}

function extractSayExactlyTarget(
  messages: ChatRequest["messages"]
): string | null {
  const lastUserMessage = getLastUserMessage(messages);

  const match = lastUserMessage.match(/^say exactly:\s*([\s\S]+?)\s*$/i);

  if (!match?.[1]) {
    return null;
  }

  return match[1]
    .trim()
    .replace(/^["'“”‘’]+/, "")
    .replace(/["'“”‘’]+$/, "");
}

function messagesToPrompt(messages: ChatRequest["messages"]): string {
  const systemMessages: string[] = [];
  const conversationMessages: string[] = [];

  for (const message of messages) {
    const content = stringifyMessageContent(message.content).trim();

    if (!content) {
      continue;
    }

    if (message.role === "system") {
      systemMessages.push(content);
    } else {
      conversationMessages.push(`${message.role.toUpperCase()}:\n${content}`);
    }
  }

  return [
    "You are the final assistant response generator for an OpenAI-compatible /v1/chat/completions endpoint.",
    "Return ONLY the assistant message content that should be sent back to the client.",
    "Do not include analysis.",
    "Do not include reasoning.",
    "Do not include safety checks.",
    "Do not include numbered steps.",
    "Do not explain what the user wants.",
    "Do not include phrases like 'The user wants', 'Analyze the request', or 'Final Output Generation'.",
    "If the user asks you to say something exactly, output only that exact text.",
    "",
    systemMessages.length > 0
      ? `SYSTEM INSTRUCTIONS:\n${systemMessages.join("\n\n")}`
      : "",
    `CONVERSATION:\n${conversationMessages.join("\n\n")}`,
    "",
    "ASSISTANT MESSAGE CONTENT ONLY:"
  ]
    .filter(Boolean)
    .join("\n");
}

function extractThreadId(result: any): string {
  const threadId = result?.thread?.id ?? result?.threadId ?? result?.id;

  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new Error(
      `Codex app-server did not return a thread id: ${JSON.stringify(result)}`
    );
  }

  return threadId;
}

function extractModels(result: any): CodexModel[] {
  if (Array.isArray(result?.data)) {
    return result.data;
  }

  if (Array.isArray(result?.models)) {
    return result.models;
  }

  return [];
}

function chooseModel(models: CodexModel[], requestedModel: string): CodexModel {
  const visibleModels = models.filter((model) => !model.hidden);

  const exact = visibleModels.find(
    (model) => model.id === requestedModel || model.model === requestedModel
  );

  const selected =
    exact ??
    visibleModels.find((model) => model.isDefault) ??
    visibleModels.find((model) => model.id === "gpt-5.5") ??
    visibleModels.find((model) => model.model === "gpt-5.5") ??
    visibleModels[0];

  if (!selected) {
    throw new Error(
      `No usable Codex models found. Raw model list: ${JSON.stringify(models)}`
    );
  }

  return selected;
}

function extractTextDelta(params: any): string {
  const delta =
    params?.delta ?? params?.text ?? params?.chunk ?? params?.content ?? "";

  return typeof delta === "string" ? delta : "";
}

function extractAgentTextFromItem(item: any): string {
  if (!item || item.type !== "agentMessage") {
    return "";
  }

  if (typeof item.text === "string") {
    return item.text;
  }

  if (Array.isArray(item.content)) {
    return item.content
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }

  return "";
}

function stripLeakedReasoning(text: string): string {
  const trimmed = text.trim();

  const finalOutputMatch = trimmed.match(
    /(?:final output generation|final output|final decision|answer):?\s*(?:\n|\r\n)+([\s\S]+)$/i
  );

  if (finalOutputMatch?.[1]) {
    const candidate = finalOutputMatch[1].trim();

    const lastNonEmptyLine = candidate
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);

    if (lastNonEmptyLine) {
      return lastNonEmptyLine.replace(/^[-*]\s*/, "").trim();
    }

    return candidate;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const looksLikeReasoningLeak =
    /^the user wants/i.test(trimmed) ||
    /^analyze the request/i.test(trimmed) ||
    trimmed.includes("**Analyze the Request:**") ||
    trimmed.includes("**Check for Safety") ||
    trimmed.includes("Final Output Generation") ||
    trimmed.includes("Final Decision");

  if (looksLikeReasoningLeak && lines.length > 0) {
    return lines[lines.length - 1]!.replace(/^[-*]\s*/, "").trim();
  }

  return trimmed;
}

function postProcessAssistantContent(
  rawContent: string,
  messages: ChatRequest["messages"]
): string {
  const sayExactlyTarget = extractSayExactlyTarget(messages);

  if (sayExactlyTarget !== null) {
    return sayExactlyTarget;
  }

  return stripLeakedReasoning(rawContent);
}

export class CodexCliProvider implements Provider {
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const result = await this.runCodexTurn(request);

    return {
      content: result.content,
      raw: result
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const sayExactlyTarget = extractSayExactlyTarget(request.messages);

    if (sayExactlyTarget !== null) {
      yield {
        content: sayExactlyTarget,
        raw: {
          provider: "codex",
          shortcut: "say_exactly"
        }
      };

      return;
    }

    const queue = new AsyncChunkQueue<ChatStreamChunk>();

    this.runCodexTurn(request, (content, raw) => {
      queue.push({
        content,
        raw
      });
    })
      .then(() => {
        queue.end();
      })
      .catch((error) => {
        queue.throw(error);
      });

    yield* queue;
  }

  private runCodexTurn(
    request: ChatRequest,
    onDelta?: (content: string, raw: unknown) => void
  ): Promise<CodexTurnResult> {
    const command = process.env.CODEX_CLI_COMMAND ?? "codex";
    const workdir = process.env.CODEX_WORKDIR ?? process.cwd();
    const timeoutMs = Number(process.env.CODEX_TIMEOUT_MS ?? 180000);
    const requestedModel = process.env.CODEX_MODEL || request.model || "gpt-5.5";
    const sandboxMode = process.env.CODEX_SANDBOX_MODE ?? "read-only";
    const approvalPolicy = process.env.CODEX_APPROVAL_POLICY ?? "never";
    const configuredReasoningEffort = process.env.CODEX_REASONING_EFFORT;
    const prompt = messagesToPrompt(request.messages);

    return new Promise((resolve, reject) => {
      const child = spawn(command, ["app-server", "--listen", "stdio://"], {
        cwd: workdir,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"]
      });

      let nextId = 1;
      let settled = false;
      let stderr = "";
      let streamedContent = "";
      let completedAgentText = "";
      let selectedModel = requestedModel;
      let threadId: string | undefined;
      let turnId: string | undefined;
      let tokenUsage: unknown;

      const rawEvents: JsonRpcMessage[] = [];
      const pending = new Map<JsonRpcId, PendingRequest>();

      let readline: Interface | undefined;

      const cleanup = () => {
        clearTimeout(timer);
        pending.clear();
        readline?.close();

        if (!child.killed) {
          child.kill("SIGTERM");
        }
      };

      const fail = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      };

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();

        const rawContent = completedAgentText || streamedContent;
        const content = postProcessAssistantContent(rawContent, request.messages);

        resolve({
          content,
          rawContent,
          rawEvents,
          tokenUsage,
          selectedModel,
          threadId,
          turnId
        });
      };

      const timer = setTimeout(() => {
        fail(new Error(`Codex app-server timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const send = (method: string, params?: unknown): Promise<unknown> => {
        const id = nextId++;
        const payload: JsonRpcRequest = { id, method, params };

        child.stdin.write(`${JSON.stringify(payload)}\n`);

        return new Promise((requestResolve, requestReject) => {
          pending.set(id, {
            resolve: requestResolve,
            reject: requestReject
          });
        });
      };

      const notify = (method: string, params?: unknown) => {
        const payload: JsonRpcNotification = { method, params };
        child.stdin.write(`${JSON.stringify(payload)}\n`);
      };

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        fail(error);
      });

      child.on("exit", (code, signal) => {
        if (settled) {
          return;
        }

        fail(
          new Error(
            `Codex app-server exited before completion: code=${code}, signal=${signal}, stderr=${stderr.trim()}`
          )
        );
      });

      readline = createInterface({
        input: child.stdout
      });

      readline.on("line", (line) => {
        if (!line.trim()) {
          return;
        }

        let message: JsonRpcMessage;

        try {
          message = JSON.parse(line);
        } catch (error) {
          fail(
            new Error(
              `Failed to parse Codex app-server JSON line: ${line}\n${String(error)}`
            )
          );
          return;
        }

        rawEvents.push(message);

        if (message.id !== undefined && pending.has(message.id)) {
          const pendingRequest = pending.get(message.id)!;
          pending.delete(message.id);

          if (message.error) {
            pendingRequest.reject(
              new Error(`${message.error.message} (${message.error.code})`)
            );
          } else {
            pendingRequest.resolve(message.result);
          }

          return;
        }

        if (message.method === "item/agentMessage/delta") {
          const delta = extractTextDelta(message.params);

          if (delta) {
            streamedContent += delta;
            onDelta?.(delta, message);
          }

          return;
        }

        if (message.method === "item/completed") {
          const params: any = message.params ?? {};
          const text = extractAgentTextFromItem(params.item);

          if (text) {
            completedAgentText = text;
          }

          return;
        }

        if (message.method === "thread/tokenUsage/updated") {
          tokenUsage = (message.params as any)?.tokenUsage ?? message.params;
          return;
        }

        if (message.method === "turn/completed") {
          const params: any = message.params ?? {};
          const turn = params.turn;

          if (turn?.id && typeof turn.id === "string") {
            turnId = turn.id;
          }

          if (params.threadId && typeof params.threadId === "string") {
            threadId = params.threadId;
          }

          if (turn?.status === "failed" || turn?.error) {
            fail(
              new Error(
                `Codex turn failed: ${turn?.error?.message ?? JSON.stringify(turn)}`
              )
            );
            return;
          }

          finish();
          return;
        }

        if (message.method === "error") {
          const params: any = message.params ?? {};
          fail(
            new Error(
              `Codex app-server error: ${
                params?.error?.message ?? JSON.stringify(params)
              }`
            )
          );
        }
      });

      void (async () => {
        try {
          await send("initialize", {
            clientInfo: {
              name: "cline-model-router",
              title: "Cline Model Router",
              version: "0.1.0"
            },
            capabilities: {
              experimentalApi: true,
              optOutNotificationMethods: null
            }
          });

          notify("initialized");

          await send("account/read", {
            refreshToken: false
          });

          const modelResult = await send("model/list", {
            cursor: null,
            limit: null,
            includeHidden: true
          });

          const models = extractModels(modelResult);
          const codexModel = chooseModel(models, requestedModel);
          selectedModel = codexModel.model;

          const reasoningEffort =
            configuredReasoningEffort ??
            codexModel.defaultReasoningEffort ??
            "medium";

          const threadResult = await send("thread/start", {
            cwd: workdir,
            approvalPolicy,
            sandboxMode,
            model: selectedModel,
            reasoningEffort
          });

          threadId = extractThreadId(threadResult);

          const turnResult: any = await send("turn/start", {
            threadId,
            input: [
              {
                type: "text",
                text: prompt
              }
            ],
            model: selectedModel,
            cwd: workdir,
            approvalPolicy,
            sandboxMode,
            reasoningEffort
          });

          if (typeof turnResult?.turn?.id === "string") {
            turnId = turnResult.turn.id;
          }
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });
  }
}
