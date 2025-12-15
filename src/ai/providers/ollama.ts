import { RedocConfig } from '../../types.js';
import { AIProvider, AIChatMessage, ProviderAvailability } from '../types.js';

export class OllamaProvider implements AIProvider {
  id: 'ollama' = 'ollama';

  isConfigured(config: RedocConfig): boolean {
    return Boolean(config.ollamaUrl) && Boolean(config.ollamaModel);
  }

  async isAvailable(config: RedocConfig): Promise<ProviderAvailability> {
    const configured = this.isConfigured(config);
    if (!configured) return { id: this.id, configured: false, available: false, reason: 'Missing ollamaUrl/ollamaModel' };

    try {
      const res = await fetch(new URL('/api/tags', config.ollamaUrl).toString(), { method: 'GET' });
      if (!res.ok) {
        return { id: this.id, configured: true, available: false, reason: `Ollama not reachable (${res.status})` };
      }
      return { id: this.id, configured: true, available: true };
    } catch (e: any) {
      return { id: this.id, configured: true, available: false, reason: e?.message || 'Ollama not reachable' };
    }
  }

  private async chatRaw(params: {
    config: RedocConfig;
    messages: AIChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    if (!params.config.ollamaUrl || !params.config.ollamaModel) {
      throw new Error('Ollama config missing');
    }

    const res = await fetch(new URL('/api/chat', params.config.ollamaUrl).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: params.config.ollamaModel,
        stream: false,
        options: {
          temperature: params.temperature ?? 0.7,
          num_predict: params.maxTokens ?? 2000
        },
        messages: params.messages
      })
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Ollama error ${res.status}: ${txt}`);
    }

    const json: any = await res.json();
    const text = json?.message?.content;
    if (!text) throw new Error('No response from Ollama');
    return String(text);
  }

  async chatText(params: {
    config: RedocConfig;
    messages: AIChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    return this.chatRaw(params);
  }

  async chatJson<T>(params: {
    config: RedocConfig;
    messages: AIChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<T> {
    const text = await this.chatRaw({ ...params, temperature: params.temperature ?? 0.2 });
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('Ollama returned non-JSON');
    }
    return JSON.parse(text.slice(start, end + 1)) as T;
  }
}
