import { MODELS } from "./models";

<<<<<<< HEAD
export type ProviderName = "lmstudio" | "claudeBedrock" | "claudeDirect" | "nvidia";
=======
export type ProviderName =
  | "lmstudio"
  | "claudeBedrock"
  | "claudeDirect"
  | "gpt"
  | "nvidia";
>>>>>>> c6972ae (init commit)

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

<<<<<<< HEAD
    strengths: ["coding", "simple_code", "small_refactor", "docs"]
  },

  claudeHaiku: {
    id: MODELS.claudeHaiku,
    provider: process.env.CLAUDE_PROVIDER === "direct" ? "claudeDirect" : "claudeBedrock",
=======
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
>>>>>>> c6972ae (init commit)

    quality: 3,
    speed: 8,
    cost: 2,
    latency: 7,

<<<<<<< HEAD
    strengths: ["agentic_edits", "quick_code", "docs"]
  },

  claudeSonnet: {
    id: MODELS.claudeSonnet,
    provider: process.env.CLAUDE_PROVIDER === "direct" ? "claudeDirect" : "claudeBedrock",
=======
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
>>>>>>> c6972ae (init commit)

    quality: 4,
    speed: 7,
    cost: 4,
    latency: 7,

<<<<<<< HEAD
    strengths: ["cline_act", "multi_file", "implementation", "debugging", "coding"]
=======
    strengths: [
      "cline_act",
      "multi_file",
      "implementation",
      "debugging",
      "coding"
    ]
>>>>>>> c6972ae (init commit)
  },

  claudeOpus: {
    id: MODELS.claudeOpus,
<<<<<<< HEAD
    provider: process.env.CLAUDE_PROVIDER === "direct" ? "claudeDirect" : "claudeBedrock",
=======
    provider:
      process.env.CLAUDE_PROVIDER === "direct"
        ? "claudeDirect"
        : "claudeBedrock",
>>>>>>> c6972ae (init commit)

    quality: 5,
    enabled: false,
    speed: 5,
    cost: 7,
    latency: 7,

<<<<<<< HEAD
    strengths: ["architecture", "project_setup", "large_scope", "reasoning", "debugging"]
  },

  deepseekFlash: {
=======
    strengths: [
      "architecture",
      "project_setup",
      "large_scope",
      "reasoning",
      "debugging"
    ]
  },

  deepseekFlash: {
  enabled: false,
>>>>>>> c6972ae (init commit)
    id: MODELS.deepseekFlash,
    provider: "nvidia",

    quality: 4,
    speed: 7,
    cost: 0,
    latency: 5,

    enabled: process.env.ENABLE_DEEPSEEK !== "false",

<<<<<<< HEAD
    strengths: ["implementation", "coding", "fast_reasoning", "quick_code"]
  },

  deepseekPro: {
=======
    strengths: [
      "implementation",
      "coding",
      "fast_reasoning",
      "quick_code"
    ]
  },

  deepseekPro: {
  enabled: false,
>>>>>>> c6972ae (init commit)
    id: MODELS.deepseekPro,
    provider: "nvidia",

    quality: 5,
    speed: 4,
    cost: 0,
    latency: 7,

    enabled: process.env.ENABLE_DEEPSEEK !== "false",

<<<<<<< HEAD
    strengths: ["architecture", "debugging", "reasoning", "large_scope", "implementation"]
  },

  qwen3Coder: {
=======
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
>>>>>>> c6972ae (init commit)
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
<<<<<<< HEAD

  stepFlash: {
=======
  minimax: {
	  enabled: true,
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
  enabled: true,
>>>>>>> c6972ae (init commit)
    id: MODELS.stepFlash,
    provider: "nvidia",

    quality: 3,
    speed: 6,
    cost: 0,
    latency: 4,

<<<<<<< HEAD
    strengths: ["quick_code", "docs", "simple_code", "fast_reasoning"]
=======
    strengths: [
      "quick_code",
      "docs",
      "simple_code",
      "fast_reasoning"
    ]
>>>>>>> c6972ae (init commit)
  },

  mistralMedium: {
    id: MODELS.mistralMedium,
    provider: "nvidia",
    quality: 5,
    speed: 3,
    cost: 0,
    latency: 7,
<<<<<<< HEAD
    enabled: false,

    strengths: ["cline_act", "multi_file", "implementation", "debugging", "coding"]
=======
    enabled: true,


  strengths: [
      "cline_act",
      "multi_file",
      "implementation",
      "debugging",
      "coding"
    ]
>>>>>>> c6972ae (init commit)
  },

  mistralLarge: {
    id: MODELS.mistralLarge,
    provider: "nvidia",
    quality: 6,
    speed: 3,
    cost: 0,
<<<<<<< HEAD
    enabled: false,
    latency: 8,

    strengths: ["architecture", "project_setup", "large_scope", "reasoning", "debugging"]
=======
    enabled: true,
    latency: 8,


    strengths: [
      "architecture",
      "project_setup",
      "large_scope",
      "reasoning",
      "debugging"
    ]
>>>>>>> c6972ae (init commit)
  },

  glm47: {
    id: MODELS.glm47,
    provider: "nvidia",
    quality: 2,
    speed: 4,
    cost: 0,
    latency: 5,
    enabled: false,
<<<<<<< HEAD
    strengths: ["implementation", "reasoning", "coding", "large_context"]
=======
    strengths: [
      "implementation",
      "reasoning",
      "coding",
      "large_context"
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

    enabled: process.env.ENABLE_CODEX !== "false",

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
>>>>>>> c6972ae (init commit)
  }
};
