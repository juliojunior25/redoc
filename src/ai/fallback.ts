import { RedocConfig } from '../types.js';
import { AIProvider, ProviderAvailability, ProviderId } from './types.js';
import { GroqProvider } from './providers/groq.js';
import { GeminiProvider } from './providers/gemini.js';
import { CerebrasProvider } from './providers/cerebras.js';
import { OllamaProvider } from './providers/ollama.js';

export const ALL_PROVIDERS: AIProvider[] = [
  new GroqProvider(),
  new GeminiProvider(),
  new CerebrasProvider(),
  new OllamaProvider()
];

export async function getAvailability(config: RedocConfig): Promise<ProviderAvailability[]> {
  const results = await Promise.all(
    ALL_PROVIDERS.map(p => p.isAvailable(config).catch((e: any) => ({
      id: p.id,
      configured: p.isConfigured(config),
      available: false,
      reason: e?.message || 'Unavailable'
    })))
  );
  return results;
}

export async function chooseProviderOrder(params: {
  config: RedocConfig;
  preferred?: ProviderId;
}): Promise<AIProvider[]> {
  const preferred = params.preferred;
  const availability = await getAvailability(params.config);
  const byId = new Map(availability.map(a => [a.id, a]));

  const providerById = new Map(ALL_PROVIDERS.map(p => [p.id, p]));

  const ordered: AIProvider[] = [];

  const pushIf = (id: ProviderId) => {
    if (id === 'offline') return;
    const provider = providerById.get(id as any);
    if (!provider) return;
    if (ordered.some(p => p.id === provider.id)) return;

    const info = byId.get(provider.id);
    if (info?.available) ordered.push(provider);
  };

  const userOrder = params.config.generation?.providerOrder;

  if (Array.isArray(userOrder) && userOrder.length > 0) {
    // User-defined order: preferred (if any) → configured list
    if (preferred) pushIf(preferred);
    for (const id of userOrder) pushIf(id);
  } else {
    // Default chain: preferred → Ollama (if running) → any available
    if (preferred) pushIf(preferred);
    pushIf('ollama');

    for (const a of availability) {
      if (a.available) pushIf(a.id);
    }
  }

  return ordered;
}

export async function tryProviders<T>(params: {
  config: RedocConfig;
  preferred?: ProviderId;
  run: (provider: AIProvider) => Promise<T>;
}): Promise<{ value?: T; provider?: ProviderId; error?: unknown }> {
  const order = await chooseProviderOrder({ config: params.config, preferred: params.preferred });
  let lastError: unknown;

  for (const provider of order) {
    try {
      const value = await params.run(provider);
      return { value, provider: provider.id };
    } catch (e) {
      lastError = e;
      continue;
    }
  }

  return { error: lastError };
}
