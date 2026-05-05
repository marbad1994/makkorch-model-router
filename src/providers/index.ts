import { ClaudeBedrockProvider } from "./claudeBedrock";
<<<<<<< HEAD
=======
import { CodexCliProvider } from "./codexCli";
>>>>>>> c6972ae (init commit)
import { LMStudioProvider } from "./lmstudio";
import { NvidiaProvider } from "./nvidia";

export const providers = {
  lmstudio: new LMStudioProvider(),
  claudeBedrock: new ClaudeBedrockProvider(),
<<<<<<< HEAD
  nvidia: new NvidiaProvider()
};

export function isProviderConfigured(provider: keyof typeof providers): boolean {
=======
  nvidia: new NvidiaProvider(),
  gpt: new CodexCliProvider()
};

export function isProviderConfigured(
  provider: keyof typeof providers
): boolean {
>>>>>>> c6972ae (init commit)
  if (provider === "lmstudio") {
    return Boolean(process.env.LMSTUDIO_URL);
  }

  if (provider === "claudeBedrock") {
    return Boolean(process.env.AWS_REGION);
  }

  if (provider === "nvidia") {
    return Boolean(process.env.NVIDIA_API_KEY);
  }

<<<<<<< HEAD
=======
  if (provider === "gpt") {
    return process.env.ENABLE_CODEX !== "false";
  }

>>>>>>> c6972ae (init commit)
  return false;
}
