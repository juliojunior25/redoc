import * as path from 'path';
import * as fs from 'fs/promises';
import { ConfigManager } from '../utils/config.js';
import { GitManager } from '../utils/git.js';

/**
 * Post-commit hook.
 *
 * Captures commit diffs into a local staging area so a final report can be
 * generated later (e.g. via `redoc post-push`).
 *
 * Important: this hook must never block commits; failures are swallowed.
 */
export async function postCommitCommand(): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const config = await configManager.load().catch(() => null);
    if (!config) return;

    const docsRoot = configManager.resolveDocsPath(config);
    const captureRoot = path.join(docsRoot, '.commits');
    await fs.mkdir(captureRoot, { recursive: true });

    const git = new GitManager();
    const branch = await git.getCurrentBranch();

    // Create a new version entry under the capture folder
    const nextVersion = await git.getNextVersionNumber(captureRoot, branch);
    const last = await git.getLastCommitInfo();
    const diff = await git.getDiffForCommit(last.hash);

    await git.createVersionFile(captureRoot, branch, {
      version: nextVersion,
      timestamp: new Date().toISOString(),
      commit: last.hash,
      message: last.message,
      diffs: diff,
      files: last.files
    });
  } catch {
    // Never fail the user's commit
    return;
  }
}
