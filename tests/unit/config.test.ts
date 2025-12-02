import { ConfigManager } from '../../src/utils/config';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock file system
jest.mock('fs/promises');

describe('ConfigManager', () => {
  const mockConfigPath = '/test/.redocrc.json';
  const mockConfig = {
    projectName: 'test-project',
    submodulePath: '/test/redocs',
    groqApiKey: 'gsk_test123',
    aiProvider: 'groq' as const
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('load', () => {
    it('should load configuration from disk', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));

      const configManager = new ConfigManager('/test');
      const config = await configManager.load();

      expect(config).toEqual(mockConfig);
      expect(fs.readFile).toHaveBeenCalledWith(
        expect.stringContaining('.redocrc.json'),
        'utf-8'
      );
    });

    it('should throw error if not initialized', async () => {
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('File not found'));

      const configManager = new ConfigManager('/test');

      await expect(configManager.load()).rejects.toThrow('not initialized');
    });

    it('should cache configuration', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));

      const configManager = new ConfigManager('/test');
      await configManager.load();
      await configManager.load();

      expect(fs.readFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('save', () => {
    it('should save configuration to disk', async () => {
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      const configManager = new ConfigManager('/test');
      await configManager.save(mockConfig);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.redocrc.json'),
        JSON.stringify(mockConfig, null, 2),
        'utf-8'
      );
    });
  });

  describe('update', () => {
    it('should update specific fields', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      const configManager = new ConfigManager('/test');
      const updated = await configManager.update({
        projectName: 'new-name'
      });

      expect(updated.projectName).toBe('new-name');
      expect(updated.submodulePath).toBe(mockConfig.submodulePath);
    });
  });

  describe('isInitialized', () => {
    it('should return true if config exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);

      const configManager = new ConfigManager('/test');
      const result = await configManager.isInitialized();

      expect(result).toBe(true);
    });

    it('should return false if config does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('Not found'));

      const configManager = new ConfigManager('/test');
      const result = await configManager.isInitialized();

      expect(result).toBe(false);
    });
  });

  describe('createInitialConfig', () => {
    it('should create initial configuration', async () => {
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      const config = await ConfigManager.createInitialConfig(
        '/test',
        'my-project',
        '/test/redocs',
        'gsk_test123'
      );

      expect(config.projectName).toBe('my-project');
      expect(config.submodulePath).toBe('/test/redocs');
      expect(config.groqApiKey).toBe('gsk_test123');
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });
});
