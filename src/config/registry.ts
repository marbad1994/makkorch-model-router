import { MODELS } from "./models";

export type ProviderName =
  | "lmstudio"
  | "claudeBedrock"
  | "claudeDirect"
  | "gpt"
  | "nvidia"
  | "deepseek";

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

    strengths: [
      "coding",
      "simple_code",
      "small_refactor",
      "docs"
    ]
  },

  claudeHaiku: {
    enabled: false,
    id: MODELS.claudeHaiku,
    provider:
      process.env.CLAUDE_PROVIDER === "direct"
        ? "claudeDirect"
        : "claudeBedrock",

    quality: 3,
    speed: 8,
    cost: 2,
    latency: 7,

    strengths: [
      "agentic_edits",
      "quick_code",
      "docs"
    ]
  },

  claudeSonnet: {
    enabled: false,
    id: MODELS.claudeSonnet,
    provider:
      process.env.CLAUDE_PROVIDER === "direct"
        ? "claudeDirect"
        : "claudeBedrock",

    quality: 4,
    speed: 7,
    cost: 4,
    latency: 7,

    strengths: [
      "cline_act",
      "multi_file",
      "implementation",
      "debugging",
      "coding"
    ]
  },

  claudeOpus: {
    id: MODELS.claudeOpus,
    provider:
      process.env.CLAUDE_PROVIDER === "direct"
        ? "claudeDirect"
        : "claudeBedrock",

    quality: 5,
    enabled: false,
    speed: 5,
    cost: 7,
    latency: 7,

    strengths: [
      "architecture",
      "project_setup",
      "large_scope",
      "reasoning",
      "debugging"
    ]
  },

  deepseekFlash: {
    id: MODELS.deepseekFlash,
    provider: "deepseek",

    quality: 4,
    speed: 7,
    cost: 2,
    latency: 5,

    enabled: true,

    strengths: [
      "implementation",
      "coding",
      "fast_reasoning",
      "quick_code"
    ]
  },

  deepseekPro: {
    id: MODELS.deepseekPro,
    provider: "deepseek",

    quality: 5,
    speed: 4,
    cost: 2,
    latency: 7,

    enabled: true,

    strengths: [
      "architecture",
      "debugging",
      "reasoning",
      "large_scope",
      "implementation"
    ]
  },

  qwen3Coder: {
    enabled: true,
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
  minimax: {
    enabled: false,
    id: MODELS.minimax,
    provider: "nvidia",
    quality: 4,
    speed: 4,
    cost: 0,
    latency: 6,
    strengths: [
      "coding",
      "implementation",
      "quick_code",
      "docs",
      "simple_code",
      "fast_reasoning"
    ]
  },


  stepFlash: {
    enabled: false,
    id: MODELS.stepFlash,
    provider: "nvidia",

    quality: 3,
    speed: 6,
    cost: 0,
    latency: 4,

    strengths: [
      "quick_code",
      "docs",
      "simple_code",
      "fast_reasoning"
    ]
  },

  mistralMedium: {
    id: MODELS.mistralMedium,
    provider: "nvidia",
    quality: 5,
    speed: 3,
    cost: 0,
    latency: 7,
    enabled: false,

    strengths: [
      "cline_act",
      "multi_file",
      "implementation",
      "debugging",
      "coding"
    ]
  },

  mistralLarge: {
    id: MODELS.mistralLarge,
    provider: "nvidia",
    quality: 6,
    speed: 3,
    cost: 0,
    enabled: true,
    latency: 8,

    strengths: [
      "architecture",
      "project_setup",
      "large_scope",
      "reasoning",
      "debugging"
    ]
  },
  lama: {
    id: MODELS.lama,
    provider: "nvidia",
    quality: 6,
    speed: 4,
    cost: 0,
    enabled: false,
    latency: 6,
    strengths: [
      "architecture",
      "project_setup",
      "large_scope",
      "reasoning",
      "debugging"
    ]
  },
  gpt55: {
  enabled: false,
    id: MODELS.gpt55,
    provider: "gpt",

    quality: 5,
    speed: 6,
    cost: 6,
    latency: 6,


    strengths: [
      "architecture",
      "implementation",
      "debugging",
      "reasoning",
      "hard_logic",
      "large_scope",
      "agentic_edits",
      "coding"
    ]
  }
};
