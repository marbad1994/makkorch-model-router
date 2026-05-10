import { REGISTRY } from "../config/registry";
import { providers } from "../providers";
import type { ChatStreamChunk } from "../types/provider";

export interface ExecuteModelOptions {
  promptCache?: boolean;
}

export async function executeModel(
  registryKey: keyof typeof REGISTRY,
  messages: any[],
  options: ExecuteModelOptions = {}
) {
  const profile = REGISTRY[registryKey];

  const provider = providers[profile.provider];

  if (!provider) {
    throw new Error(`Missing provider: ${profile.provider}`);
  }

  return provider.chat({
    model: profile.id,
    messages,
    promptCache: options.promptCache
  });
}

export async function* executeModelStream(
  registryKey: keyof typeof REGISTRY,
  messages: any[],
  options: ExecuteModelOptions = {}
): AsyncIterable<ChatStreamChunk> {
  const profile = REGISTRY[registryKey];

  const provider = providers[profile.provider];

  if (!provider) {
    throw new Error(`Missing provider: ${profile.provider}`);
  }

  if (provider.chatStream) {
    yield* provider.chatStream({
      model: profile.id,
      messages,
      stream: true,
      promptCache: options.promptCache
    });

    return;
  }

  const response = await provider.chat({
    model: profile.id,
    messages,
    stream: false,
    promptCache: options.promptCache
  });

  const chunks = response.content.match(/.{1,50}/gs) ?? [];

  for (const chunk of chunks) {
    yield {
      content: chunk,
      raw: response.raw
    };
  }
}
