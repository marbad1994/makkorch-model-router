import { Provider, ChatRequest, ChatResponse, ChatStreamChunk } from "../types/provider";

type NvidiaPayload = {
  model: string;
  messages: ChatRequest["messages"];
  max_tokens: number;
  temperature: number;
  top_p: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream: boolean;
  chat_template_kwargs?: {
    thinking?: boolean;
    reasoning_effort?: string;
  };
};

function getNvidiaBaseUrl(): string {
  return process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
}

function getNvidiaInvokeUrl(): string {
  return `${getNvidiaBaseUrl().replace(/\/$/, "")}/chat/completions`;
}

function isReasoningModel(model: string): boolean {
  const lower = model.toLowerCase();

  return (
    lower.includes("deepseek") ||
    lower.includes("qwen") ||
    lower.includes("glm") ||
    lower.includes("stepfun") ||
    lower.includes("reasoning")
  );
}

function isMistralModel(model: string): boolean {
  return model.toLowerCase().includes("mistral");
}

function getReasoningEffort(model: string): string {
  const lower = model.toLowerCase();

  if (lower.includes("pro")) {
    return process.env.NVIDIA_REASONING_EFFORT_PRO ?? "high";
  }

  return process.env.NVIDIA_REASONING_EFFORT_FLASH ?? "medium";
}

function buildPayload(request: ChatRequest, stream: boolean): NvidiaPayload {
  const model = request.model;

  const payload: NvidiaPayload = {
    model,
    messages: request.messages,
    max_tokens: Number(process.env.NVIDIA_MAX_TOKENS ?? 16384),
    temperature: request.temperature ?? Number(process.env.NVIDIA_TEMPERATURE ?? 0.15),
    top_p: Number(process.env.NVIDIA_TOP_P ?? 1),
    frequency_penalty: Number(process.env.NVIDIA_FREQUENCY_PENALTY ?? 0),
    presence_penalty: Number(process.env.NVIDIA_PRESENCE_PENALTY ?? 0),
    stream
  };

  /*
   * Mistral-style NVIDIA models should receive a plain OpenAI-compatible
   * payload. Do NOT attach chat_template_kwargs.
   *
   * Example:
   * mistralai/mistral-large-3-675b-instruct-2512
   */
  if (isMistralModel(model)) {
    return payload;
  }

  /*
   * Reasoning models can receive NVIDIA-specific thinking config.
   */
  if (isReasoningModel(model)) {
    payload.chat_template_kwargs = {
      thinking: true,
      reasoning_effort: getReasoningEffort(model)
    };
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
    delta.reasoning_content ?? delta.reasoning ?? delta.thinking ?? delta.thoughts ?? ""
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

export class NvidiaProvider implements Provider {
  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!process.env.NVIDIA_API_KEY) {
      throw new Error("Missing NVIDIA_API_KEY");
    }

    const response = await fetch(getNvidiaInvokeUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildPayload(request, false))
    });

    if (!response.ok) {
      const errorText = await readErrorResponse(response);
      throw new Error(`NVIDIA failed: ${response.status} ${errorText}`);
    }

    const json = await response.json();

    return {
      content: extractContent(json),
      raw: json
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    if (!process.env.NVIDIA_API_KEY) {
      throw new Error("Missing NVIDIA_API_KEY");
    }

    const response = await fetch(getNvidiaInvokeUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        Accept: "text/event-stream",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildPayload(request, true))
    });

    if (!response.ok) {
      const errorText = await readErrorResponse(response);
      throw new Error(`NVIDIA stream failed: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error("NVIDIA stream failed: empty response body");
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

        /*
         * Some providers include final usage on a streamed event.
         * Yield it as an event so executeChain can capture token usage
         * without sending visible content to Cline.
         */
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
