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
    aiProvider: 'groq' as const
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

      expect(config).toEqual(mockConfig);
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
      expect(config.submodulePath).toBe('/test/redocs');
      expect(config.groqApiKey).toBe('gsk_test123');
      expect(mockWriteFile).toHaveBeenCalled();
    });
  });
});
