import { RedocConfig } from '../../types.js';
import { AIProvider, AIChatMessage, ProviderAvailability } from '../types.js';

export class GeminiProvider implements AIProvider {
  id: 'gemini' = 'gemini';

  isConfigured(config: RedocConfig): boolean {
    return Boolean(config.geminiApiKey);
  }

  async isAvailable(config: RedocConfig): Promise<ProviderAvailability> {
    const configured = this.isConfigured(config);
    if (!configured) return { id: this.id, configured: false, available: false, reason: 'Missing geminiApiKey' };
    return { id: this.id, configured: true, available: true };
  }

  private endpoint(config: RedocConfig): string {
    if (!config.geminiApiKey) throw new Error('Gemini API key missing');
    return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.geminiApiKey}`;
  }

  private toGemini(messages: AIChatMessage[]) {
    // Gemini has no explicit system role in the same way; we inline system into first user.
    const system = messages.find(m => m.role === 'system')?.content;
    const user = messages.filter(m => m.role === 'user').map(m => m.content).join('\n\n');
    const text = system ? `${system}\n\n${user}` : user;

    return {
      contents: [{ role: 'user', parts: [{ text }] }]
    };
  }

  async chatText(params: {
    config: RedocConfig;
    messages: AIChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const body = {
      ...this.toGemini(params.messages),
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 2000
      }
    };

    const res = await fetch(this.endpoint(params.config), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Gemini error ${res.status}: ${txt}`);
    }

    const json: any = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
    if (!text) throw new Error('No response from Gemini');
    return String(text);
  }

  async chatJson<T>(params: {
    config: RedocConfig;
    messages: AIChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<T> {
    const text = await this.chatText({
      ...params,
      temperature: params.temperature ?? 0.2
    });

    // Try to extract JSON object even if model returns extra text.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('Gemini returned non-JSON');
    }

    return JSON.parse(text.slice(start, end + 1)) as T;
  }
}
