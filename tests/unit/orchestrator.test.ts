import { describe, it, expect } from 'bun:test';
import { planDocument } from '../../src/ai/orchestrator.js';
import { RedocConfig } from '../../src/types.js';
import { ChangeContext } from '../../src/ai/types.js';

describe('orchestrator', () => {
  const mockConfig: RedocConfig = {
    projectName: 'test-project',
    aiProvider: 'groq'
  };

  const mockCtx: ChangeContext = {
    branch: 'main',
    commits: [{ hash: '1234567', message: 'feat: add something' }],
    files: ['src/index.ts'],
    diff: '+ const x = 1;'
  };

  describe('planDocument', () => {
    it('should return a valid plan in offline mode', async () => {
      // We force offline by not providing API keys and using a non-existent provider or just relying on fallback
      const { plan, provider } = await planDocument({
        config: { ...mockConfig, aiProvider: 'groq', groqApiKey: undefined },
        ctx: mockCtx,
        qa: [],
        hasDeveloperDiagrams: false,
        hasDeveloperTables: false
      });

      expect(plan).toBeDefined();
      expect(plan.intent).toBe('unknown');
      expect(plan.impactedFiles).toBeArray();
      expect(provider).toBe('offline');
    });

    it('should correctly handle developer provided diagrams/tables', async () => {
      const { plan } = await planDocument({
        config: mockConfig,
        ctx: mockCtx,
        qa: [],
        hasDeveloperDiagrams: true,
        hasDeveloperTables: true
      });

      expect(plan.shouldGenerateDiagram).toBe(false);
      expect(plan.shouldGenerateTable).toBe(false);
    });
  });
});
