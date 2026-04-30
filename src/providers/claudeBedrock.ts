import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand
} from "@aws-sdk/client-bedrock-runtime";
import { Provider, ChatRequest, ChatResponse, ChatStreamChunk } from "../types/provider";

type BedrockClaudeMessage = {
  role: "user" | "assistant";
  content: Array<{
    type: "text";
    text: string;
  }>;
};

export class ClaudeBedrockProvider implements Provider {
  private client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION ?? "eu-central-1"
  });

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { system, messages } = this.normalizeMessages(request.messages);

    const body = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: Number(process.env.CLAUDE_MAX_TOKENS ?? 24096),
      ...(system ? { system } : {}),
      messages
    };

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
    const { system, messages } = this.normalizeMessages(request.messages);

    const body = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: Number(process.env.CLAUDE_MAX_TOKENS ?? 24096),
      ...(system ? { system } : {}),
      messages
    };

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

  private normalizeMessages(messages: ChatRequest["messages"]): {
    system?: string;
    messages: BedrockClaudeMessage[];
  } {
    const systemMessages: string[] = [];
    const normalized: BedrockClaudeMessage[] = [];

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

    return {
      system: systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined,
      messages: this.ensureAlternatingMessages(normalized)
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
