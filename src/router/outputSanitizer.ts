type ChatMessageLike = {
  role?: string;
  content?: unknown;
};

type StreamChunkLike = {
  content?: string;
};

function stringifyContent(content: unknown): string {
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

function getLastUserMessage(messages: ChatMessageLike[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    if (message?.role === "user") {
      return stringifyContent(message.content).trim();
    }
  }

  return "";
}

function removeWrappingQuotes(value: string): string {
  const trimmed = value.trim();

  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
    ["`", "`"]
  ];

  for (const [open, close] of quotePairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close) && trimmed.length >= 2) {
      return trimmed.slice(open.length, trimmed.length - close.length);
    }
  }

  return trimmed;
}

export function extractSayExactlyTarget(messages: ChatMessageLike[]): string | null {
  const lastUserMessage = getLastUserMessage(messages);

  const match = lastUserMessage.match(/^say exactly:\s*([\s\S]+?)\s*$/i);

  if (!match?.[1]) {
    return null;
  }

  return removeWrappingQuotes(match[1]);
}

function looksLikeReasoningLeak(text: string): boolean {
  const trimmed = text.trim();

  return (
    /^the user wants\b/i.test(trimmed) ||
    /^we need\b/i.test(trimmed) ||
    /^i need to\b/i.test(trimmed) ||
    /^i should\b/i.test(trimmed) ||
    /^let me\b/i.test(trimmed) ||
    /^analyze the request\b/i.test(trimmed) ||
    /^analysis\b\s*:/i.test(trimmed) ||
    /^reasoning\b\s*:/i.test(trimmed) ||
    trimmed.includes("**Analyze the Request:**") ||
    trimmed.includes("**Check for Safety") ||
    trimmed.includes("Final Output Generation") ||
    trimmed.includes("Final Decision") ||
    trimmed.includes("The user asked") ||
    trimmed.includes("The user is asking") ||
    trimmed.includes("I will output") ||
    trimmed.includes("I should output")
  );
}

function extractAfterFinalMarker(text: string): string | null {
  const markers = [
    /(?:final output generation|final output|final answer|final decision|answer):?\s*(?:\n|\r\n)+([\s\S]+)$/i,
    /\*\*final output generation:\*\*\s*(?:\n|\r\n)+([\s\S]+)$/i,
    /\*\*final answer:\*\*\s*(?:\n|\r\n)+([\s\S]+)$/i
  ];

  for (const marker of markers) {
    const match = text.match(marker);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function extractLastUsefulBlock(text: string): string {
  const trimmed = text.trim();

  const fencedBlocks = [...trimmed.matchAll(/```[\s\S]*?```/g)];

  if (fencedBlocks.length > 0) {
    return fencedBlocks[fencedBlocks.length - 1]![0].trim();
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return trimmed;
  }

  const lastLine = lines[lines.length - 1]!.trim();

  return lastLine.replace(/^[-*]\s*/, "").trim();
}

export function sanitizeAssistantContent(
  rawContent: string,
  messages: ChatMessageLike[]
): string {
  const sayExactlyTarget = extractSayExactlyTarget(messages);

  if (sayExactlyTarget !== null) {
    return sayExactlyTarget;
  }

  const trimmed = rawContent.trim();

  if (!trimmed) {
    return "";
  }

  const afterFinalMarker = extractAfterFinalMarker(trimmed);

  if (afterFinalMarker) {
    return extractLastUsefulBlock(afterFinalMarker);
  }

  if (looksLikeReasoningLeak(trimmed)) {
    return extractLastUsefulBlock(trimmed);
  }

  return trimmed;
}

export async function* sanitizeAssistantStream<T extends StreamChunkLike>(
  chunks: AsyncIterable<T>,
  messages: ChatMessageLike[]
): AsyncIterable<string> {
  const sayExactlyTarget = extractSayExactlyTarget(messages);

  if (sayExactlyTarget !== null) {
    yield sayExactlyTarget;
    return;
  }

  let buffer = "";
  let passthrough = false;
  let suspectedLeak = false;

  for await (const chunk of chunks) {
    const content = chunk.content ?? "";

    if (!content) {
      continue;
    }

    if (passthrough) {
      yield content;
      continue;
    }

    buffer += content;

    if (looksLikeReasoningLeak(buffer)) {
      suspectedLeak = true;
      continue;
    }

    if (!suspectedLeak && (buffer.length >= 300 || /\n/.test(buffer))) {
      passthrough = true;
      yield buffer;
      buffer = "";
    }
  }

  if (!buffer) {
    return;
  }

  if (
    suspectedLeak ||
    looksLikeReasoningLeak(buffer) ||
    extractAfterFinalMarker(buffer)
  ) {
    const cleaned = sanitizeAssistantContent(buffer, messages);

    if (cleaned) {
      yield cleaned;
    }

    return;
  }

  yield buffer;
}
