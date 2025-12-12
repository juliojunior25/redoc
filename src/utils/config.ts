import * as fs from 'fs/promises';
import * as path from 'path';
import { RedocConfig } from '../types.js';

/**
 * Manages ReDoc configuration persistence
 */
export class ConfigManager {
  private configPath: string;
  private config: RedocConfig | null = null;

  constructor(projectRoot: string = process.cwd()) {
    this.configPath = path.join(projectRoot, '.redocrc.json');
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
      this.config = parsed;
      return parsed;
    } catch (error) {
      throw new Error('ReDoc not initialized. Run "redoc init" first.');
    }
  }

  /**
   * Save configuration to disk
   */
  async save(config: RedocConfig): Promise<void> {
    const content = JSON.stringify(config, null, 2);
    await fs.writeFile(this.configPath, content, 'utf-8');
    this.config = config;
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
    return config.submodulePath;
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
    submodulePath: string,
    groqApiKey?: string
  ): Promise<RedocConfig> {
    const config: RedocConfig = {
      projectName,
      submodulePath,
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
