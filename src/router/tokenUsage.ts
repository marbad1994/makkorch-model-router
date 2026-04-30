export type NormalizedTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
  estimated: boolean;
  source: string;
};

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function fromOpenAIUsage(usage: any, source: string): NormalizedTokenUsage | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const inputTokens =
    numberOrZero(usage.prompt_tokens) || numberOrZero(usage.input_tokens);

  const outputTokens =
    numberOrZero(usage.completion_tokens) || numberOrZero(usage.output_tokens);

  const totalTokens =
    numberOrZero(usage.total_tokens) ||
    numberOrZero(usage.totalTokens) ||
    inputTokens + outputTokens;

  const cachedInputTokens =
    numberOrZero(usage.prompt_tokens_details?.cached_tokens) ||
    numberOrZero(usage.cachedInputTokens) ||
    numberOrZero(usage.cached_input_tokens);

  const reasoningOutputTokens =
    numberOrZero(usage.completion_tokens_details?.reasoning_tokens) ||
    numberOrZero(usage.reasoningOutputTokens) ||
    numberOrZero(usage.reasoning_output_tokens);

  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: cachedInputTokens || undefined,
    reasoningOutputTokens: reasoningOutputTokens || undefined,
    estimated: false,
    source
  };
}

function fromCodexTokenUsage(
  tokenUsage: any,
  source: string
): NormalizedTokenUsage | null {
  if (!tokenUsage || typeof tokenUsage !== "object") {
    return null;
  }

  const total = tokenUsage.total ?? tokenUsage.last ?? tokenUsage;

  const inputTokens = numberOrZero(total.inputTokens) || numberOrZero(total.input_tokens);

  const outputTokens =
    numberOrZero(total.outputTokens) || numberOrZero(total.output_tokens);

  const totalTokens =
    numberOrZero(total.totalTokens) ||
    numberOrZero(total.total_tokens) ||
    inputTokens + outputTokens;

  const cachedInputTokens =
    numberOrZero(total.cachedInputTokens) || numberOrZero(total.cached_input_tokens);

  const reasoningOutputTokens =
    numberOrZero(total.reasoningOutputTokens) ||
    numberOrZero(total.reasoning_output_tokens);

  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: cachedInputTokens || undefined,
    reasoningOutputTokens: reasoningOutputTokens || undefined,
    estimated: false,
    source
  };
}

function fromClaudeUsage(raw: any, source: string): NormalizedTokenUsage | null {
  const usage = raw?.usage ?? raw?.message?.usage;

  if (!usage || typeof usage !== "object") {
    return null;
  }

  const inputTokens = numberOrZero(usage.input_tokens);
  const outputTokens = numberOrZero(usage.output_tokens);
  const totalTokens = inputTokens + outputTokens;

  if (totalTokens === 0) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens:
      numberOrZero(usage.cache_read_input_tokens) ||
      numberOrZero(usage.cache_creation_input_tokens) ||
      undefined,
    estimated: false,
    source
  };
}

export function extractTokenUsage(raw: unknown): NormalizedTokenUsage | null {
  const data: any = raw;

  if (!data || typeof data !== "object") {
    return null;
  }

  return (
    fromOpenAIUsage(data.usage, "raw.usage") ??
    fromOpenAIUsage(data?.params?.usage, "raw.params.usage") ??
    fromCodexTokenUsage(data.tokenUsage, "raw.tokenUsage") ??
    fromCodexTokenUsage(data?.params?.tokenUsage, "raw.params.tokenUsage") ??
    fromClaudeUsage(data, "raw.claude.usage") ??
    null
  );
}

export function estimateTokenUsageFromText(args: {
  promptText: string;
  outputText: string;
  source?: string;
}): NormalizedTokenUsage {
  const inputTokens = estimateTokens(args.promptText);
  const outputTokens = estimateTokens(args.outputText);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimated: true,
    source: args.source ?? "estimated_chars_div_4"
  };
}

export function preferActualUsage(
  current: NormalizedTokenUsage | null,
  next: NormalizedTokenUsage | null
): NormalizedTokenUsage | null {
  if (!next) {
    return current;
  }

  if (!current) {
    return next;
  }

  if (!next.estimated && current.estimated) {
    return next;
  }

  if (!next.estimated && !current.estimated) {
    return next;
  }

  return current;
}
