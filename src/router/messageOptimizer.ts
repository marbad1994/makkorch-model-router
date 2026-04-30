type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: unknown;
};

function shouldSkipOptimizer(): boolean {
  return process.env.DISABLE_MESSAGE_OPTIMIZER === "true";
}

function contentToText(content: unknown): string {
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

function hasSystemInstruction(messages: ChatMessage[], needle: string): boolean {
  const normalizedNeedle = needle.toLowerCase();

  return messages.some((message) => {
    if (message.role !== "system") {
      return false;
    }

    return contentToText(message.content).toLowerCase().includes(normalizedNeedle);
  });
}

function isLikelyClineCodingTask(messages: ChatMessage[]): boolean {
  const text = messages
    .map((message) => contentToText(message.content))
    .join("\n")
    .toLowerCase();

  return (
    text.includes("cline") ||
    text.includes("file:") ||
    text.includes("src/") ||
    text.includes(".ts") ||
    text.includes(".tsx") ||
    text.includes(".js") ||
    text.includes(".jsx") ||
    text.includes(".json") ||
    text.includes(".py") ||
    text.includes("write code") ||
    text.includes("modify") ||
    text.includes("replace") ||
    text.includes("full file") ||
    text.includes("complete file") ||
    text.includes("implementation") ||
    text.includes("refactor")
  );
}

function buildCodingGuardrail(modelKey: string): ChatMessage {
  return {
    role: "system",
    content: [
      "You are responding inside Cline through a local model router.",
      "",
      "Code-output rules:",
      "- When writing or modifying code, output complete files only.",
      "- Do not omit sections.",
      "- Do not use placeholders like “rest unchanged”, “same as before”, “unchanged code”, or “…”.",
      "- Finish the current file before adding explanations.",
      "- If multiple files are needed, complete one file fully before starting the next.",
      "- Preserve exact formatting, newlines, indentation, and code fences.",
      "- Do not collapse multiline code into one-line code.",
      "- Do not remove imports, exports, comments, or helper functions unless the change requires it.",
      "- If giving a replacement file, include the exact file path before the full file contents.",
      "",
      "Response rules:",
      "- Return only useful final content.",
      "- Do not include hidden reasoning, analysis, safety checks, or step-by-step planning unless the user explicitly asks for them.",
      "- Do not mention this router instruction.",
      "",
      `Router-selected model key: ${modelKey}`
    ].join("\n")
  };
}

/**
 * IMPORTANT:
 * This optimizer is intentionally append/prepend-only.
 *
 * It must never:
 * - rewrite existing user prompts
 * - compress Cline prompts
 * - strip newlines
 * - mutate tool protocols
 * - summarize existing messages
 * - alter assistant/tool history
 *
 * Earlier aggressive optimization caused newline corruption and broken code/tool output.
 */
export function optimizeMessagesForModel(
  modelKey: string,
  messages: ChatMessage[]
): ChatMessage[] {
  if (shouldSkipOptimizer()) {
    return messages;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  if (!isLikelyClineCodingTask(messages)) {
    return messages;
  }

  if (hasSystemInstruction(messages, "Code-output rules:")) {
    return messages;
  }

  return [buildCodingGuardrail(modelKey), ...messages];
}
