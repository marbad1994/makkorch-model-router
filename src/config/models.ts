function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function envOrDefault(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const MODELS = {
  ministral: requiredEnv("LM_MINISTRAL"),

  claudeHaiku: requiredEnv("CLAUDE_HAIKU"),
  claudeSonnet: requiredEnv("CLAUDE_SONNET"),
  claudeOpus: requiredEnv("CLAUDE_OPUS"),

  deepseekFlash: requiredEnv("NVIDIA_DEEPSEEK_FLASH"),
  deepseekPro: requiredEnv("NVIDIA_DEEPSEEK_PRO"),
  glm47: requiredEnv("NVIDIA_GLM47"),
  qwen3Coder: requiredEnv("NVIDIA_QWEN3"),
  stepFlash: requiredEnv("NVIDIA_STEP_FLASH"),
  mistralMedium: requiredEnv("NVIDIA_MISTRAL_MEDIUM"),
  mistralLarge: requiredEnv("NVIDIA_MISTRAL_LARGE")
};
