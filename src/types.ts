/**
 * Main configuration for ReDoc
 */
export interface RedocConfig {
  submodulePath: string;
  projectName: string;
  groqApiKey?: string;
  currentBranch?: string;
  aiProvider?: 'groq' | 'openai';
  openaiApiKey?: string;
  editor?: string;
  templatePath?: string;  // Path to custom template file (.redoc-template.md)
  redactSecrets?: boolean; // Redact secrets from diffs before sending to AI (default: true)
}

/**
 * Represents a single commit version
 */
export interface CommitVersion {
  version: string;        // "1.0", "2.0", etc
  timestamp: string;
  commit: string;        // hash do commit
  message: string;
  diffs: string;         // output de git show
  files: string[];       // arquivos modificados
}

/**
 * AI-generated question for brain dump
 */
export interface GroqQuestion {
  id: string;           // "what_and_why", etc
  section: string;      // "Essencial"
  question: string;     // Pergunta gerada
  context?: string;     // Contexto do código
}

/**
 * Final generated document
 */
export interface FinalDocument {
  title: string;
  branch: string;
  content: string;      // Markdown completo
  metadata: {
    createdAt: string;
    commits: string[];
    versions: number;
  };
}

/**
 * Git commit information
 */
export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
}

/**
 * Brain dump answers
 */
export interface BrainDumpAnswers {
  what_and_why: string;
  key_decisions: string;
  gotchas: string;
  additional_context: string;
  [key: string]: string;
}
