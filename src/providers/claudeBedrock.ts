import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand
} from "@aws-sdk/client-bedrock-runtime";
import {
  Provider,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk
} from "../types/provider";

type BedrockClaudeContentBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

type BedrockClaudeMessage = {
  role: "user" | "assistant";
  content: BedrockClaudeContentBlock[];
};

export class ClaudeBedrockProvider implements Provider {
  private client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION ?? "eu-central-1"
  });

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const promptCache = promptCacheEnabled(request);
    const { system, messages } = this.normalizeMessages(request.messages, {
      promptCache
    });

    const body: Record<string, unknown> = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: Number(process.env.CLAUDE_MAX_TOKENS ?? 24096),
      messages
    };

    if (system) {
      body.system = system;
    }

    const command = new InvokeModelCommand({
      modelId: request.model,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(body)
    });

    const response = await this.client.send(command);

    const rawText = new TextDecoder().decode(response.body);
    const json = JSON.parse(rawText);

    const content =
      json.content
        ?.filter((item: any) => item.type === "text")
        ?.map((item: any) => item.text)
        ?.join("\n") ?? "";

    return {
      content,
      raw: json
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const promptCache = promptCacheEnabled(request);
    const { system, messages } = this.normalizeMessages(request.messages, {
      promptCache
    });

    const body: Record<string, unknown> = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: Number(process.env.CLAUDE_MAX_TOKENS ?? 24096),
      messages
    };

    if (system) {
      body.system = system;
    }

    const command = new InvokeModelWithResponseStreamCommand({
      modelId: request.model,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(body)
    });

    const response = await this.client.send(command);

    if (!response.body) {
      throw new Error("Claude Bedrock stream failed: empty response body");
    }

    for await (const event of response.body as any) {
      const bytes = event.chunk?.bytes;

      if (!bytes) {
        continue;
      }

      const rawText = new TextDecoder().decode(bytes);
      const json = JSON.parse(rawText);

      if (json.type === "content_block_delta") {
        const text = json.delta?.text ?? "";

        if (text) {
          yield {
            content: text,
            raw: json
          };
        }
      }

      if (json.type === "message_stop") {
        return;
      }
    }
  }

  private normalizeMessages(
    messages: ChatRequest["messages"],
    opts?: { promptCache?: boolean }
  ): {
    system?: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
    messages: BedrockClaudeMessage[];
  } {
    const systemMessages: string[] = [];
    const normalized: BedrockClaudeMessage[] = [];
    const promptCache = opts?.promptCache ?? false;

    for (const message of messages) {
      const text = this.contentToText(message.content);

      if (!text.trim()) {
        continue;
      }

      if (message.role === "system") {
        systemMessages.push(text);
        continue;
      }

      if (message.role !== "user" && message.role !== "assistant") {
        continue;
      }

      normalized.push({
        role: message.role,
        content: [
          {
            type: "text",
            text
          }
        ]
      });
    }

    if (normalized.length === 0) {
      normalized.push({
        role: "user",
        content: [
          {
            type: "text",
            text: "Hello"
          }
        ]
      });
    }

    const merged = this.ensureAlternatingMessages(normalized);

    // Apply prompt caching markers when enabled.
    // Strategy: mark the last 2 conversation turns as NOT cached
    // (they change frequently), and everything before that as cached.
    // System prompt is always cached when prompt cache is enabled.
    if (promptCache) {
      const UNCacheableMessageCount = 2; // last 2 messages not cached
      const cacheableCount = Math.max(0, merged.length - UNCacheableMessageCount);

      for (let i = 0; i < merged.length; i++) {
        const msg = merged[i]!;
        // Only mark the last content block in each cacheable message
        if (i < cacheableCount && msg.content.length > 0) {
          const lastBlock = msg.content[msg.content.length - 1]!;
          lastBlock.cache_control = { type: "ephemeral" };
        }
      }
    }

    return {
      system:
        systemMessages.length > 0
          ? promptCache
            ? [
                {
                  type: "text" as const,
                  text: systemMessages.join("\n\n"),
                  cache_control: { type: "ephemeral" as const }
                }
              ]
            : systemMessages.join("\n\n")
          : undefined,
      messages: merged
    };
  }

  private contentToText(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }

          if (
            part &&
            typeof part === "object" &&
            "text" in part &&
            typeof (part as any).text === "string"
          ) {
            return (part as any).text;
          }

          return "";
        })
        .filter(Boolean)
        .join("\n");
    }

    if (
      content &&
      typeof content === "object" &&
      "text" in content &&
      typeof (content as any).text === "string"
    ) {
      return (content as any).text;
    }

    return "";
  }

  private ensureAlternatingMessages(
    messages: BedrockClaudeMessage[]
  ): BedrockClaudeMessage[] {
    const result: BedrockClaudeMessage[] = [];

    for (const message of messages) {
      const previous = result[result.length - 1];

      if (!previous || previous.role !== message.role) {
        result.push(message);
        continue;
      }

      previous.content.push(...message.content);
    }

    return result;
  }
}

/**
 * Returns true when prompt caching should be applied for this request.
 *
 * Prompt caching is enabled when:
 * 1. The global env PROMPT_CACHE_ENABLED is "true" (default: true for Claude),
 *    AND
 * 2. The request does not explicitly disable it via promptCache: false.
 *
 * When enabled, cache_control markers are added to system messages and
 * conversation prefixes (all but the last 2 turns) so Claude caches them
 * server-side. Cache read tokens cost ~90% less; cache write tokens cost
 * ~25% more. The cache TTL is 5 minutes, refreshed on each use.
 */
function promptCacheEnabled(request: ChatRequest): boolean {
  const globalEnabled =
    process.env.PROMPT_CACHE_ENABLED !== "false"; // default true

  if (!globalEnabled) {
    return false;
  }

  // Per-request opt-out
  if (request.promptCache === false) {
    return false;
  }

  return true;
}
