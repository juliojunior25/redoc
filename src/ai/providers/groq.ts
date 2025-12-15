import Groq from 'groq-sdk';
import { RedocConfig } from '../../types.js';
import { AIProvider, AIChatMessage, ProviderAvailability } from '../types.js';

export class GroqProvider implements AIProvider {
  id: 'groq' = 'groq';

  isConfigured(config: RedocConfig): boolean {
    return Boolean(config.groqApiKey);
  }

  async isAvailable(config: RedocConfig): Promise<ProviderAvailability> {
    const configured = this.isConfigured(config);
    if (!configured) return { id: this.id, configured: false, available: false, reason: 'Missing groqApiKey' };
    return { id: this.id, configured: true, available: true };
  }

  private client(config: RedocConfig): Groq {
    if (!config.groqApiKey) throw new Error('Groq API key missing');
    return new Groq({ apiKey: config.groqApiKey });
  }

  async chatText(params: {
    config: RedocConfig;
    messages: AIChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const completion = await this.client(params.config).chat.completions.create({
      messages: params.messages,
      model: 'llama-3.3-70b-versatile',
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 2000
    });

    const text = completion.choices[0]?.message?.content;
    if (!text) throw new Error('No response from Groq');
    return text;
  }

  async chatJson<T>(params: {
    config: RedocConfig;
    messages: AIChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<T> {
    const completion = await this.client(params.config).chat.completions.create({
      messages: params.messages,
      model: 'llama-3.3-70b-versatile',
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 2000,
      response_format: { type: 'json_object' }
    });

    const text = completion.choices[0]?.message?.content;
    if (!text) throw new Error('No response from Groq');
    return JSON.parse(text) as T;
  }
}
