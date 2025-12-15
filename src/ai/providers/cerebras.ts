import { RedocConfig } from '../../types.js';
import { AIProvider, AIChatMessage, ProviderAvailability } from '../types.js';

export class CerebrasProvider implements AIProvider {
  id: 'cerebras' = 'cerebras';

  isConfigured(config: RedocConfig): boolean {
    return Boolean(config.cerebrasApiKey);
  }

  async isAvailable(config: RedocConfig): Promise<ProviderAvailability> {
    const configured = this.isConfigured(config);
    if (!configured) return { id: this.id, configured: false, available: false, reason: 'Missing cerebrasApiKey' };
    return { id: this.id, configured: true, available: true };
  }

  private endpoint(): string {
    // Cerebras OpenAI-compatible endpoint.
    return 'https://api.cerebras.ai/v1/chat/completions';
  }

  async chatText(params: {
    config: RedocConfig;
    messages: AIChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    if (!params.config.cerebrasApiKey) throw new Error('Cerebras API key missing');

    const res = await fetch(this.endpoint(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${params.config.cerebrasApiKey}`
      },
      body: JSON.stringify({
        model: 'llama3.3-70b',
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 2000
      })
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Cerebras error ${res.status}: ${txt}`);
    }

    const json: any = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    if (!text) throw new Error('No response from Cerebras');
    return String(text);
  }

  async chatJson<T>(params: {
    config: RedocConfig;
    messages: AIChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<T> {
    const text = await this.chatText({ ...params, temperature: params.temperature ?? 0.2 });
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('Cerebras returned non-JSON');
    }
    return JSON.parse(text.slice(start, end + 1)) as T;
  }
}
