import type {
  Provider,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk
} from "../types/provider";

type DeepSeekPayload = {
  model: string;
  messages: ChatRequest["messages"];
  max_tokens: number;
  temperature: number;
  top_p: number;
  stream: boolean;
  thinking?: {
    type: "enabled" | "disabled";
  };
  reasoning_effort?: string;
};

function getBaseUrl(): string {
  return process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
}

function getInvokeUrl(): string {
  return `${getBaseUrl().replace(/\/$/, "")}/chat/completions`;
}

function isProModel(model: string): boolean {
  return model.toLowerCase().includes("pro");
}

function buildPayload(request: ChatRequest, stream: boolean): DeepSeekPayload {
  const model = request.model;

  const payload: DeepSeekPayload = {
    model,
    messages: request.messages,
    max_tokens: Number(process.env.DEEPSEEK_MAX_TOKENS ?? 65536),
    temperature: request.temperature ?? Number(process.env.DEEPSEEK_TEMPERATURE ?? 1),
    top_p: Number(process.env.DEEPSEEK_TOP_P ?? 1),
    stream
  };

  /* DeepSeek thinking mode — enabled by default for both flash and pro.
   * Can be disabled by setting DEEPSEEK_THINKING_ENABLED=false. */
  const thinkingEnabled = process.env.DEEPSEEK_THINKING_ENABLED !== "false";

  if (thinkingEnabled) {
    payload.thinking = { type: "enabled" };

    payload.reasoning_effort =
      process.env.DEEPSEEK_REASONING_EFFORT ??
      (isProModel(model) ? "high" : "high");
  }

  return payload;
}

function extractContent(json: any): string {
  return json?.choices?.[0]?.message?.content ?? "";
}

function extractDeltaContent(json: any): string {
  return json?.choices?.[0]?.delta?.content ?? "";
}

function extractReasoningDelta(json: any): string {
  const delta = json?.choices?.[0]?.delta ?? {};

  return (
    delta.reasoning_content ??
    delta.reasoning ??
    delta.thinking ??
    ""
  );
}

function parseSseEvents(buffer: string): {
  events: string[];
  rest: string;
} {
  const events: string[] = [];
  const parts = buffer.split(/\n\n/);

  const rest = parts.pop() ?? "";

  for (const part of parts) {
    const lines = part
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (!line.startsWith("data:")) {
        continue;
      }

      events.push(line.slice("data:".length).trim());
    }
  }

  return {
    events,
    rest
  };
}

async function readErrorResponse(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

export class DeepSeekProvider implements Provider {
  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error("Missing DEEPSEEK_API_KEY");
    }

    const response = await fetch(getInvokeUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildPayload(request, false))
    });

    if (!response.ok) {
      const errorText = await readErrorResponse(response);
      throw new Error(`DeepSeek failed: ${response.status} ${errorText}`);
    }

    const json = await response.json();

    return {
      content: extractContent(json),
      raw: json
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error("Missing DEEPSEEK_API_KEY");
    }

    const response = await fetch(getInvokeUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        Accept: "text/event-stream",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildPayload(request, true))
    });

    if (!response.ok) {
      const errorText = await readErrorResponse(response);
      throw new Error(`DeepSeek stream failed: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error("DeepSeek stream failed: empty response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const parsed = parseSseEvents(buffer);
      buffer = parsed.rest;

      for (const event of parsed.events) {
        if (event === "[DONE]") {
          return;
        }

        const json = JSON.parse(event);

        const reasoningDelta = extractReasoningDelta(json);

        if (typeof reasoningDelta === "string" && reasoningDelta.length > 0) {
          yield {
            content: "",
            kind: "thinking",
            raw: json
          };
        }

        const content = extractDeltaContent(json);

        if (content) {
          yield {
            content,
            kind: "content",
            raw: json
          };
        }

        /* Usage stats may arrive on a streamed event.  Yield as an event
         * so executeChain can capture token counts. */
        if (json.usage) {
          yield {
            content: "",
            kind: "event",
            raw: json
          };
        }
      }
    }
  }
}
