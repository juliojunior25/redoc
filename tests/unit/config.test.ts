import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ConfigManager } from '../../src/utils/config';

// Mock file system
const mockReadFile = mock();
const mockWriteFile = mock();
const mockAccess = mock();

mock.module('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  access: mockAccess,
}));

describe('ConfigManager', () => {
  const mockConfig = {
    projectName: 'test-project',
    submodulePath: '/test/redocs',
    groqApiKey: 'gsk_test123',
    aiProvider: 'groq' as const,
    redactSecrets: true
  };

  const expectedLoadedConfig = {
    ...mockConfig,
    docsPath: mockConfig.submodulePath,
    language: 'en' as const,
    versionDocs: true,
    generation: {
      parallel: false,
      providers: {
        analysis: 'groq' as const,
        content: 'groq' as const,
        diagrams: 'groq' as const
      }
    }
  };

  beforeEach(() => {
    mockReadFile.mockClear();
    mockWriteFile.mockClear();
    mockAccess.mockClear();
  });

  describe('load', () => {
    it('should load configuration from disk', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));

      const configManager = new ConfigManager('/test');
      const config = await configManager.load();

      expect(config).toEqual(expectedLoadedConfig);
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    it('should throw error if not initialized', async () => {
      mockReadFile.mockRejectedValue(new Error('File not found'));

      const configManager = new ConfigManager('/test');

      await expect(configManager.load()).rejects.toThrow('not initialized');
    });

    it('should cache configuration', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));

      const configManager = new ConfigManager('/test');
      await configManager.load();
      await configManager.load();

      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('save', () => {
    it('should save configuration to disk', async () => {
      mockWriteFile.mockResolvedValue(undefined);

      const configManager = new ConfigManager('/test');
      await configManager.save(mockConfig);

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('should update specific fields', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
      mockWriteFile.mockResolvedValue(undefined);

      const configManager = new ConfigManager('/test');
      const updated = await configManager.update({
        projectName: 'new-name'
      });

      expect(updated.projectName).toBe('new-name');
      expect(updated.submodulePath).toBe(mockConfig.submodulePath);
      expect(updated.docsPath).toBe(mockConfig.submodulePath);
    });
  });

  describe('isInitialized', () => {
    it('should return true if config exists', async () => {
      mockAccess.mockResolvedValue(undefined);

      const configManager = new ConfigManager('/test');
      const result = await configManager.isInitialized();

      expect(result).toBe(true);
    });

    it('should return false if config does not exist', async () => {
      mockAccess.mockRejectedValue(new Error('Not found'));

      const configManager = new ConfigManager('/test');
      const result = await configManager.isInitialized();

      expect(result).toBe(false);
    });
  });

  describe('createInitialConfig', () => {
    it('should create initial configuration', async () => {
      mockWriteFile.mockResolvedValue(undefined);

      const config = await ConfigManager.createInitialConfig(
        '/test',
        'my-project',
        '/test/redocs',
        'gsk_test123'
      );

      expect(config.projectName).toBe('my-project');
      expect(config.docsPath).toBe('/test/redocs');
      expect(config.groqApiKey).toBe('gsk_test123');
      expect(config.redactSecrets).toBe(true);
      expect(config.language).toBe('en');
      expect(config.versionDocs).toBe(true);
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should create config without groqApiKey', async () => {
      mockWriteFile.mockResolvedValue(undefined);

      const config = await ConfigManager.createInitialConfig(
        '/test',
        'my-project',
        '/test/redocs'
      );

      expect(config.projectName).toBe('my-project');
      expect(config.groqApiKey).toBeUndefined();
      expect(config.redactSecrets).toBe(true);
      expect(config.language).toBe('en');
      expect(config.versionDocs).toBe(true);
    });
  });

  describe('getGroqApiKey', () => {
    it('should return groq api key when configured', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));

      const configManager = new ConfigManager('/test');
      const apiKey = await configManager.getGroqApiKey();

      expect(apiKey).toBe('gsk_test123');
    });

    it('should throw error when groq api key not configured', async () => {
      const configWithoutKey = { ...mockConfig, groqApiKey: undefined };
      mockReadFile.mockResolvedValue(JSON.stringify(configWithoutKey));

      const configManager = new ConfigManager('/test');

      await expect(configManager.getGroqApiKey()).rejects.toThrow('Groq API key not configured');
    });
  });

  describe('setGroqApiKey', () => {
    it('should set groq api key', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));
      mockWriteFile.mockResolvedValue(undefined);

      const configManager = new ConfigManager('/test');
      await configManager.setGroqApiKey('gsk_new_key');

      expect(mockWriteFile).toHaveBeenCalled();
      const savedConfig = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(savedConfig.groqApiKey).toBe('gsk_new_key');
    });
  });

  describe('getSubmodulePath', () => {
    it('should return submodule path', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));

      const configManager = new ConfigManager('/test');
      const path = await configManager.getSubmodulePath();

      expect(path).toBe('/test/redocs');
    });
  });

  describe('getProjectName', () => {
    it('should return project name', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));

      const configManager = new ConfigManager('/test');
      const name = await configManager.getProjectName();

      expect(name).toBe('test-project');
    });
  });

  describe('delete', () => {
    const mockUnlink = mock();

    beforeEach(() => {
      mockUnlink.mockClear();
    });

    it('should delete configuration file', async () => {
      mock.module('fs/promises', () => ({
        readFile: mockReadFile,
        writeFile: mockWriteFile,
        access: mockAccess,
        unlink: mockUnlink,
      }));
      mockUnlink.mockResolvedValue(undefined);

      const configManager = new ConfigManager('/test');
      await configManager.delete();

      expect(mockUnlink).toHaveBeenCalled();
    });

    it('should not throw if config does not exist', async () => {
      mock.module('fs/promises', () => ({
        readFile: mockReadFile,
        writeFile: mockWriteFile,
        access: mockAccess,
        unlink: mockUnlink,
      }));
      mockUnlink.mockRejectedValue(new Error('File not found'));

      const configManager = new ConfigManager('/test');

      // Should complete without throwing
      await configManager.delete();
      expect(true).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('should return full configuration', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(mockConfig));

      const configManager = new ConfigManager('/test');
      const config = await configManager.getConfig();

      expect(config).toEqual(expectedLoadedConfig);
    });
  });
});
