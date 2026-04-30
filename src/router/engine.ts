import { REGISTRY } from "../config/registry";
import { providers } from "../providers";
import type { ChatStreamChunk } from "../types/provider";

export async function executeModel(registryKey: keyof typeof REGISTRY, messages: any[]) {
  const profile = REGISTRY[registryKey];

  const provider = providers[profile.provider];

  if (!provider) {
    throw new Error(`Missing provider: ${profile.provider}`);
  }

  return provider.chat({
    model: profile.id,
    messages
  });
}

export async function* executeModelStream(
  registryKey: keyof typeof REGISTRY,
  messages: any[]
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
      stream: true
    });

    return;
  }

  const response = await provider.chat({
    model: profile.id,
    messages,
    stream: false
  });

  const chunks = response.content.match(/.{1,50}/gs) ?? [];

  for (const chunk of chunks) {
    yield {
      content: chunk,
      raw: response.raw
    };
  }
}
