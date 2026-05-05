export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  stream?: boolean;
}

export interface ChatResponse {
  content: string;
  raw?: unknown;
}

<<<<<<< HEAD
export type ChatStreamChunkKind = "content" | "thinking" | "event";
=======
export type ChatStreamChunkKind =
  | "content"
  | "thinking"
  | "event";
>>>>>>> c6972ae (init commit)

export interface ChatStreamChunk {
  content: string;
  kind?: ChatStreamChunkKind;
  raw?: unknown;
}

export interface Provider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream?(request: ChatRequest): AsyncIterable<ChatStreamChunk>;
}
