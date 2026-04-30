import { ClaudeBedrockProvider } from "./claudeBedrock";
import { LMStudioProvider } from "./lmstudio";
import { NvidiaProvider } from "./nvidia";

export const providers = {
  lmstudio: new LMStudioProvider(),
  claudeBedrock: new ClaudeBedrockProvider(),
  nvidia: new NvidiaProvider()
};

export function isProviderConfigured(provider: keyof typeof providers): boolean {
  if (provider === "lmstudio") {
    return Boolean(process.env.LMSTUDIO_URL);
  }

  if (provider === "claudeBedrock") {
    return Boolean(process.env.AWS_REGION);
  }

  if (provider === "nvidia") {
    return Boolean(process.env.NVIDIA_API_KEY);
  }

  return false;
}
