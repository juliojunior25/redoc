import chalk from 'chalk';
import { GitManager } from '../utils/git.js';
import { ConfigManager } from '../utils/config.js';
import { CommitVersion } from '../types.js';

/**
 * Post-commit hook - captures commit information
 */
export async function postCommitCommand(): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();

    const gitManager = new GitManager();
    const branch = await gitManager.getCurrentBranch();

    // Get last commit info
    const commitInfo = await gitManager.getLastCommitInfo();

    // Get diff for this commit
    const diff = await gitManager.getDiffForCommit(commitInfo.hash);

    // Get next version number
    const nextVersion = await gitManager.getNextVersionNumber(
      config.submodulePath,
      branch
    );

    // Create version object
    const version: CommitVersion = {
      version: nextVersion,
      timestamp: commitInfo.date,
      commit: commitInfo.hash,
      message: commitInfo.message,
      diffs: diff,
      files: commitInfo.files
    };

    // Save version file
    await gitManager.createVersionFile(
      config.submodulePath,
      branch,
      version
    );

    console.log(chalk.green(`✓ Captured commit ${commitInfo.hash.substring(0, 7)} as version ${nextVersion}`));

  } catch (error) {
    // Silent fail for hooks - log to file instead
    console.error('ReDoc post-commit error:', error);
  }
}
