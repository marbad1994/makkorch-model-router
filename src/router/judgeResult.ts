export type JudgeVerdict = {
  pass: boolean;
  reason?: string;
};

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function isLikelyCodeTask(prompt: string): boolean {
  const lower = prompt.toLowerCase();

  return (
    lower.includes("code") ||
    lower.includes("file") ||
    lower.includes("full file") ||
    lower.includes("complete file") ||
    lower.includes("replace") ||
    lower.includes("modify") ||
    lower.includes("implement") ||
    lower.includes("refactor") ||
    lower.includes("typescript") ||
    lower.includes("javascript") ||
    lower.includes("python") ||
    lower.includes("tsx") ||
    lower.includes("jsx") ||
    lower.includes(".ts") ||
    lower.includes(".tsx") ||
    lower.includes(".js") ||
    lower.includes(".jsx") ||
    lower.includes(".py") ||
    lower.includes(".json") ||
    lower.includes("src/")
  );
}

function hasObviousTruncationMarker(output: string): boolean {
  const lower = output.toLowerCase();

  const markers = [
    "rest unchanged",
    "same as before",
    "unchanged code",
    "remaining code unchanged",
    "rest of the file",
    "rest of file",
    "continue here",
    "continues here",
    "continued below",
    "continue in next",
    "to be continued",
    "[truncated]",
    "(truncated)",
    "<truncated>",
    "output truncated",
    "response truncated",
    "snip",
    "snipped",
    "omitted for brevity",
    "omitted",
    "placeholder",
    "TODO: add the rest",
    "TODO add the rest"
  ];

  if (markers.some((marker) => lower.includes(marker))) {
    return true;
  }

  const suspiciousEllipsisPatterns = [
    /\n\s*\/\/\s*\.\.\.\s*$/m,
    /\n\s*#\s*\.\.\.\s*$/m,
    /\n\s*\/\*\s*\.\.\.\s*\*\/\s*$/m,
    /\n\s*\.\.\.\s*$/m,
    /\{\s*\.\.\.\s*\}/m,
    /\[\s*\.\.\.\s*\]/m
  ];

  return suspiciousEllipsisPatterns.some((pattern) => pattern.test(output));
}

function hasUnclosedCodeFence(output: string): boolean {
  const matches = output.match(/```/g);
  return Boolean(matches && matches.length % 2 !== 0);
}

function endsWithIncompleteSentence(output: string): boolean {
  const trimmed = output.trim();

  if (!trimmed) {
    return true;
  }

  const lastLine = trimmed.split("\n").at(-1)?.trim() ?? "";

  if (!lastLine) {
    return true;
  }

  if (/[,;:+\-*/=({[<.]$/.test(lastLine)) {
    return true;
  }

  if (
    /\b(import|export|return|const|let|var|function|class|interface|type|if|else|for|while|switch|case|try|catch|finally|await|async|from|extends|implements)\s*$/i.test(
      lastLine
    )
  ) {
    return true;
  }

  if (
    /\b(the|a|an|and|or|but|because|with|without|for|to|from|of|in|on|at|by)\s*$/i.test(
      lastLine
    )
  ) {
    return true;
  }

  return false;
}

function stripCodeFences(output: string): string {
  return output.replace(/```[a-zA-Z0-9_-]*\n?/g, "").replace(/```/g, "");
}

function countChar(text: string, char: string): number {
  return text.split(char).length - 1;
}

function hasBadBraceBalance(output: string): boolean {
  const code = stripCodeFences(output);

  const openCurly = countChar(code, "{");
  const closeCurly = countChar(code, "}");

  const openParen = countChar(code, "(");
  const closeParen = countChar(code, ")");

  const openSquare = countChar(code, "[");
  const closeSquare = countChar(code, "]");

  const curlyDiff = openCurly - closeCurly;
  const parenDiff = openParen - closeParen;
  const squareDiff = openSquare - closeSquare;

  return (
    curlyDiff >= 3 ||
    parenDiff >= 3 ||
    squareDiff >= 3 ||
    closeCurly - openCurly >= 3 ||
    closeParen - openParen >= 3 ||
    closeSquare - openSquare >= 3
  );
}

function looksLikeIncompleteCode(prompt: string, output: string): boolean {
  if (!isLikelyCodeTask(prompt)) {
    return false;
  }

  const trimmed = output.trim();

  if (!trimmed) {
    return true;
  }

  if (hasUnclosedCodeFence(trimmed)) {
    return true;
  }

  if (hasBadBraceBalance(trimmed)) {
    return true;
  }

  const lastLine = trimmed.split("\n").at(-1)?.trim() ?? "";

  if (
    lastLine.endsWith("\\") ||
    lastLine.endsWith("&&") ||
    lastLine.endsWith("||") ||
    lastLine.endsWith("?") ||
    lastLine.endsWith(":") ||
    lastLine.endsWith(",") ||
    lastLine.endsWith("=") ||
    lastLine.endsWith("(") ||
    lastLine.endsWith("{") ||
    lastLine.endsWith("[") ||
    lastLine.endsWith("<")
  ) {
    return true;
  }

  if (
    /^(import|export|return|const|let|var|function|class|interface|type)\b/.test(
      lastLine
    ) &&
    !/[;})\]`]$/.test(lastLine)
  ) {
    return true;
  }

  return false;
}

function isTooShortForRequestedFullFile(prompt: string, output: string): boolean {
  const lower = prompt.toLowerCase();

  const asksForFullFile =
    lower.includes("full file") ||
    lower.includes("complete file") ||
    lower.includes("replace the file") ||
    lower.includes("whole file") ||
    lower.includes("entire file");

  if (!asksForFullFile) {
    return false;
  }

  const outputLines = output.trim().split("\n").filter(Boolean).length;

  return outputLines < 8;
}

export function judgeResult(prompt: string, output: string): JudgeVerdict {
  const cleanOutput = normalize(output);

  if (!cleanOutput) {
    return {
      pass: false,
      reason: "empty_output"
    };
  }

  if (hasObviousTruncationMarker(cleanOutput)) {
    return {
      pass: false,
      reason: "truncation_marker_or_placeholder"
    };
  }

  if (hasUnclosedCodeFence(cleanOutput)) {
    return {
      pass: false,
      reason: "unclosed_code_fence"
    };
  }

  if (isTooShortForRequestedFullFile(prompt, cleanOutput)) {
    return {
      pass: false,
      reason: "too_short_for_requested_full_file"
    };
  }

  if (looksLikeIncompleteCode(prompt, cleanOutput)) {
    return {
      pass: false,
      reason: "incomplete_code_shape"
    };
  }

  if (isLikelyCodeTask(prompt) && endsWithIncompleteSentence(cleanOutput)) {
    return {
      pass: false,
      reason: "incomplete_ending"
    };
  }

  return {
    pass: true
  };
}
