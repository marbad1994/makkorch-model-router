import { RoutingIntent } from "../types/router";

type HeaderValue = string | string[] | number | boolean | undefined;

function normalizeHeaders(headers: Record<string, HeaderValue>): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value === undefined) {
      continue;
    }

    normalized[key.toLowerCase()] = Array.isArray(value)
      ? String(value[0] ?? "")
      : String(value);
  }

  return normalized;
}

function readHeader(headers: Record<string, string>, name: string): string | undefined {
  return headers[name.toLowerCase()];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeProfile(value: unknown): RoutingIntent["profile"] {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "fast") {
    return "fast";
  }

  if (normalized === "deep") {
    return "deep";
  }

  if (
    normalized === "free-first" ||
    normalized === "free_first" ||
    normalized === "free"
  ) {
    return "free-first";
  }

  return "balanced";
}

export function parseIntent(requestBody: any): RoutingIntent {
  const body =
    requestBody && typeof requestBody === "object"
      ? requestBody
      : { model: String(requestBody ?? "auto-cline-balanced") };

  const model = String(body.model ?? "auto-cline-balanced");

  const headers = normalizeHeaders({
    ...(body.headers ?? {}),
    ...(body._headers ?? {})
  });

  const profile = normalizeProfile(
    readHeader(headers, "x-router-profile") ?? inferProfile(model)
  );

  const speedSensitivity = clamp(
    Number(readHeader(headers, "x-router-speed") ?? inferSpeed(model)),
    1,
    10
  );

  const preferLocal = parseBoolean(
    readHeader(headers, "x-router-local-preference"),
    inferLocalPreference(model)
  );

  const allowPaid = parseBoolean(
    readHeader(headers, "x-router-allow-paid"),
    profile !== "free-first"
  );

  return {
    profile,
    speedSensitivity,
    allowPaid,
    preferLocal
  };
}

function inferProfile(model: string): RoutingIntent["profile"] {
  const lower = model.toLowerCase();

  if (lower.includes("free-first") || lower.includes("free_first")) {
    return "free-first";
  }

  if (lower.includes("fast")) {
    return "fast";
  }

  if (lower.includes("deep")) {
    return "deep";
  }

  return "balanced";
}

function inferSpeed(model: string): number {
  const match = model.match(/speed-(\d+)/i);

  if (!match) {
    return 5;
  }

  return Number(match[1]);
}

function inferLocalPreference(model: string): boolean {
  const lower = model.toLowerCase();

  return lower.includes("local") || lower.includes("free-first");
}
