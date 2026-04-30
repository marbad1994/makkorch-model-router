import { MODELS } from "./models";

export type ProviderName = "lmstudio" | "claudeBedrock" | "claudeDirect" | "nvidia";

export interface ModelProfile {
  id: string;
  provider: ProviderName;

  quality: number;
  speed: number;
  cost: number;
  latency: number;

  strengths: string[];

  local?: boolean;
  enabled?: boolean;
}

export const REGISTRY: Record<string, ModelProfile> = {
  ministral: {
    id: MODELS.ministral,
    provider: "lmstudio",
    enabled: true,
    quality: 4,
    speed: 8,
    cost: 0,
    latency: 2,

    local: true,

    strengths: ["coding", "simple_code", "small_refactor", "docs"]
  },

  claudeHaiku: {
    id: MODELS.claudeHaiku,
    provider: process.env.CLAUDE_PROVIDER === "direct" ? "claudeDirect" : "claudeBedrock",

    quality: 3,
    speed: 8,
    cost: 2,
    latency: 7,

    strengths: ["agentic_edits", "quick_code", "docs"]
  },

  claudeSonnet: {
    id: MODELS.claudeSonnet,
    provider: process.env.CLAUDE_PROVIDER === "direct" ? "claudeDirect" : "claudeBedrock",

    quality: 4,
    speed: 7,
    cost: 4,
    latency: 7,

    strengths: ["cline_act", "multi_file", "implementation", "debugging", "coding"]
  },

  claudeOpus: {
    id: MODELS.claudeOpus,
    provider: process.env.CLAUDE_PROVIDER === "direct" ? "claudeDirect" : "claudeBedrock",

    quality: 5,
    enabled: false,
    speed: 5,
    cost: 7,
    latency: 7,

    strengths: ["architecture", "project_setup", "large_scope", "reasoning", "debugging"]
  },

  deepseekFlash: {
    id: MODELS.deepseekFlash,
    provider: "nvidia",

    quality: 4,
    speed: 7,
    cost: 0,
    latency: 5,

    enabled: process.env.ENABLE_DEEPSEEK !== "false",

    strengths: ["implementation", "coding", "fast_reasoning", "quick_code"]
  },

  deepseekPro: {
    id: MODELS.deepseekPro,
    provider: "nvidia",

    quality: 5,
    speed: 4,
    cost: 0,
    latency: 7,

    enabled: process.env.ENABLE_DEEPSEEK !== "false",

    strengths: ["architecture", "debugging", "reasoning", "large_scope", "implementation"]
  },

  qwen3Coder: {
    id: MODELS.qwen3Coder,
    provider: "nvidia",

    quality: 3,
    speed: 5,
    cost: 0,
    latency: 6,

    strengths: [
      "architecture",
      "reasoning",
      "implementation",
      "code_review",
      "small_refactor"
    ]
  },

  stepFlash: {
    id: MODELS.stepFlash,
    provider: "nvidia",

    quality: 3,
    speed: 6,
    cost: 0,
    latency: 4,

    strengths: ["quick_code", "docs", "simple_code", "fast_reasoning"]
  },

  mistralMedium: {
    id: MODELS.mistralMedium,
    provider: "nvidia",
    quality: 5,
    speed: 3,
    cost: 0,
    latency: 7,
    enabled: false,

    strengths: ["cline_act", "multi_file", "implementation", "debugging", "coding"]
  },

  mistralLarge: {
    id: MODELS.mistralLarge,
    provider: "nvidia",
    quality: 6,
    speed: 3,
    cost: 0,
    enabled: false,
    latency: 8,

    strengths: ["architecture", "project_setup", "large_scope", "reasoning", "debugging"]
  },

  glm47: {
    id: MODELS.glm47,
    provider: "nvidia",
    quality: 2,
    speed: 4,
    cost: 0,
    latency: 5,
    enabled: false,
    strengths: ["implementation", "reasoning", "coding", "large_context"]
  }
};
