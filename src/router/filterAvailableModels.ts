import { REGISTRY } from "../config/registry";
import { providers, isProviderConfigured } from "../providers";

export function filterAvailableModels(): string[] {
  return Object.entries(REGISTRY)
    .filter(([_, model]) => {
      if (model.enabled === false) {
        return false;
      }

      const provider = model.provider as keyof typeof providers;

      if (!providers[provider]) {
        return false;
      }

      if (!isProviderConfigured(provider)) {
        return false;
      }

      return true;
    })
    .map(([key]) => key);
}
