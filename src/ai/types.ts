import { RedocConfig } from '../types.js';

export type ProviderId = 'groq' | 'gemini' | 'cerebras' | 'ollama' | 'offline';

export type ChangeIntent = 'feat' | 'fix' | 'refactor' | 'chore' | 'docs' | 'perf' | 'test' | 'style' | 'unknown';

export interface ImpactedFile {
  file: string;
  reason: string;
}

export interface ProviderAvailability {
  id: ProviderId;
  configured: boolean;
  available: boolean;
  reason?: string;
}

export interface AIChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface AIProvider {
  id: Exclude<ProviderId, 'offline'>;

  isConfigured(config: RedocConfig): boolean;
  isAvailable(config: RedocConfig): Promise<ProviderAvailability>;

  chatText(params: {
    config: RedocConfig;
    messages: AIChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string>;

  chatJson<T>(params: {
    config: RedocConfig;
    messages: AIChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<T>;
}

export interface ChangeContext {
  branch: string;
  commits: Array<{ hash: string; message: string }>;
  files: string[];
  diff: string;
}

export interface DocumentPlan {
  intent: ChangeIntent;
  intentRationale: string;

  impactedFiles: ImpactedFile[];

  shouldGenerateDiagram: boolean;
  diagramRationale: string | null;
  diagramType: 'sequence' | 'flowchart' | 'er' | 'state' | 'architecture' | null;
  diagramFocus: string | null;

  shouldGenerateTable: boolean;
  tableRationale: string | null;
  tableType: 'comparison' | 'tradeoffs' | 'steps' | 'options' | null;
  tableFocus?: string | null;

  keyInsights?: string[];
  complexity: 'minimal' | 'standard' | 'detailed';

  skipGeneration: boolean;
  skipReason: string | null;
}