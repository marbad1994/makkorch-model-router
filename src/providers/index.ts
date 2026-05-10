import { ClaudeBedrockProvider } from "./claudeBedrock";
import { CodexCliProvider } from "./codexCli";
import { DeepSeekProvider } from "./deepseek";
import { LMStudioProvider } from "./lmstudio";
import { NvidiaProvider } from "./nvidia";

export const providers = {
  lmstudio: new LMStudioProvider(),
  claudeBedrock: new ClaudeBedrockProvider(),
  nvidia: new NvidiaProvider(),
  deepseek: new DeepSeekProvider(),
  gpt: new CodexCliProvider()
};

export function isProviderConfigured(
  provider: keyof typeof providers
): boolean {
  if (provider === "lmstudio") {
    return Boolean(process.env.LMSTUDIO_URL);
  }

  if (provider === "claudeBedrock") {
    return Boolean(process.env.AWS_REGION);
  }

  if (provider === "nvidia") {
    return Boolean(process.env.NVIDIA_API_KEY);
  }

  if (provider === "deepseek") {
    return Boolean(process.env.DEEPSEEK_API_KEY);
  }

  if (provider === "gpt") {
    return process.env.ENABLE_CODEX !== "false";
  }

  return false;
}
