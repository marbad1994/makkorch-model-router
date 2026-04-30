import { Provider, ChatRequest, ChatResponse, ChatStreamChunk } from "../types/provider";

function parseOpenAISseData(buffer: string): {
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

  return { events, rest };
}

export class LMStudioProvider implements Provider {
  private baseUrl = process.env.LMSTUDIO_URL ?? "http://192.168.50.181:1234/v1";
  API_KEY = "sk-lm-m6UvU0TF:DIMS2p9w5be21SabSD7y";
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.API_KEY}`
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`LMStudio failed: ${response.status}`);
    }

    const json = await response.json();

    return {
      content: json.choices?.[0]?.message?.content ?? "",
      raw: json
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.API_KEY}`
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`LMStudio stream failed: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("LMStudio stream failed: empty response body");
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

      const parsed = parseOpenAISseData(buffer);
      buffer = parsed.rest;

      for (const event of parsed.events) {
        if (event === "[DONE]") {
          return;
        }

        const json = JSON.parse(event);
        const content = json.choices?.[0]?.delta?.content ?? "";

        if (content) {
          yield {
            content,
            raw: json
          };
        }
      }
    }
  }
}
