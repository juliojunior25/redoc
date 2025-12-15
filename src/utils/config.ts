import * as fs from 'fs/promises';
import * as path from 'path';
import { RedocConfig } from '../types.js';

/**
 * Manages ReDoc configuration persistence
 */
export class ConfigManager {
  private configPath: string;
  private config: RedocConfig | null = null;
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.configPath = path.join(projectRoot, '.redocrc.json');
  }

  private applyDefaultsAndEnv(config: RedocConfig): RedocConfig {
    const migrated: RedocConfig = { ...config };

    // Backward-compatible migration
    if (!migrated.docsPath && migrated.submodulePath) {
      migrated.docsPath = migrated.submodulePath;
    }

    // Defaults (PRD)
    if (!migrated.docsPath) migrated.docsPath = '.redoc';
    if (migrated.versionDocs === undefined) migrated.versionDocs = true;
    if (!migrated.language) migrated.language = 'en';
    if (!migrated.aiProvider) migrated.aiProvider = 'groq';
    if (migrated.redactSecrets === undefined) migrated.redactSecrets = true;

    if (!migrated.generation) {
      migrated.generation = { parallel: false, providers: { analysis: 'groq', content: 'groq', diagrams: 'groq' } };
    } else {
      if (migrated.generation.parallel === undefined) migrated.generation.parallel = false;
      if (!migrated.generation.providers) {
        migrated.generation.providers = { analysis: 'groq', content: 'groq', diagrams: 'groq' };
      } else {
        if (!migrated.generation.providers.analysis) migrated.generation.providers.analysis = 'groq';
        if (!migrated.generation.providers.content) migrated.generation.providers.content = 'groq';
        if (!migrated.generation.providers.diagrams) migrated.generation.providers.diagrams = 'groq';
      }
    }

    // Env overrides
    if (process.env.GROQ_API_KEY) migrated.groqApiKey = process.env.GROQ_API_KEY;
    if (process.env.GOOGLE_API_KEY) migrated.geminiApiKey = process.env.GOOGLE_API_KEY;
    if (process.env.CEREBRAS_API_KEY) migrated.cerebrasApiKey = process.env.CEREBRAS_API_KEY;
    if (process.env.REDOC_LANGUAGE) {
      const lang = process.env.REDOC_LANGUAGE;
      if (lang === 'en' || lang === 'pt-BR' || lang === 'es') {
        migrated.language = lang;
      }
    }

    return migrated;
  }

  /**
   * Load configuration from disk
   */
  async load(): Promise<RedocConfig> {
    if (this.config) {
      return this.config;
    }

    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(content) as RedocConfig;

      const normalized = this.applyDefaultsAndEnv(parsed);
      this.config = normalized;
      return normalized;
    } catch (error) {
      throw new Error('ReDoc not initialized. Run "redoc init" first.');
    }
  }

  /**
   * Save configuration to disk
   */
  async save(config: RedocConfig): Promise<void> {
    const normalized = this.applyDefaultsAndEnv(config);
    const content = JSON.stringify(normalized, null, 2);
    await fs.writeFile(this.configPath, content, 'utf-8');
    this.config = normalized;
  }

  /**
   * Update specific configuration fields
   */
  async update(updates: Partial<RedocConfig>): Promise<RedocConfig> {
    const current = await this.load();
    const updated = { ...current, ...updates };
    await this.save(updated);
    return updated;
  }

  /**
   * Check if ReDoc is initialized
   */
  async isInitialized(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get Groq API key (with validation)
   */
  async getGroqApiKey(): Promise<string> {
    const config = await this.load();

    if (!config.groqApiKey) {
      throw new Error('Groq API key not configured. Run "redoc config set groqApiKey <key>"');
    }

    return config.groqApiKey;
  }

  /**
   * Set Groq API key
   */
  async setGroqApiKey(apiKey: string): Promise<void> {
    await this.update({ groqApiKey: apiKey });
  }

  /**
   * Get submodule path
   */
  async getSubmodulePath(): Promise<string> {
    const config = await this.load();
    // Backward compatible: prefer docsPath.
    return this.resolveDocsPath(config);
  }

  /**
   * PRD name for docs storage path.
   */
  async getDocsPath(): Promise<string> {
    const config = await this.load();
    return this.resolveDocsPath(config);
  }

  resolveDocsPath(config: RedocConfig): string {
    const raw = config.docsPath || config.submodulePath || '.redoc';
    return path.isAbsolute(raw) ? raw : path.join(this.projectRoot, raw);
  }

  /**
   * Get project name
   */
  async getProjectName(): Promise<string> {
    const config = await this.load();
    return config.projectName;
  }

  /**
   * Create initial configuration
   */
  static async createInitialConfig(
    projectRoot: string,
    projectName: string,
    docsPath: string,
    groqApiKey?: string
  ): Promise<RedocConfig> {
    const config: RedocConfig = {
      projectName,
      docsPath,
      versionDocs: true,
      language: 'en',
      groqApiKey,
      aiProvider: 'groq',
      redactSecrets: true
    };

    const configPath = path.join(projectRoot, '.redocrc.json');
    const content = JSON.stringify(config, null, 2);
    await fs.writeFile(configPath, content, 'utf-8');

    return config;
  }

  /**
   * Delete configuration
   */
  async delete(): Promise<void> {
    try {
      await fs.unlink(this.configPath);
      this.config = null;
    } catch (error) {
      // Config doesn't exist, ignore
    }
  }

  /**
   * Get full configuration object
   */
  async getConfig(): Promise<RedocConfig> {
    return this.load();
  }
}
