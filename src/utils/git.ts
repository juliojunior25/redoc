import simpleGit, { SimpleGit, DefaultLogFields } from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CommitVersion, CommitInfo } from '../types.js';

export interface HooksConfig {
  isHusky: boolean;
  hooksPath: string;
  huskyVersion?: string;
}

/**
 * Manages all Git operations for ReDoc
 */
export class GitManager {
  private git: SimpleGit;
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.git = simpleGit(projectRoot);
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current || 'main';
  }

  /**
   * Check if current directory is a git repository
   */
  async isGitRepository(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Detect hooks configuration (Husky vs native)
   */
  async detectHooksConfig(): Promise<HooksConfig> {
    // Check git config for core.hooksPath
    let configuredHooksPath: string | null = null;
    try {
      const config = await this.git.raw(['config', '--get', 'core.hooksPath']);
      configuredHooksPath = config.trim();
    } catch {
      // No custom hooksPath configured
    }

    // Check for Husky directory
    const huskyPath = path.join(this.projectRoot, '.husky');
    let hasHuskyDir = false;
    try {
      await fs.access(huskyPath);
      hasHuskyDir = true;
    } catch {
      // No Husky directory
    }

    // Determine if Husky is active
    const isHusky = hasHuskyDir || (configuredHooksPath?.includes('.husky') ?? false);
    
    // Determine actual hooks path
    let hooksPath: string;
    if (configuredHooksPath) {
      // Resolve relative path
      hooksPath = path.isAbsolute(configuredHooksPath)
        ? configuredHooksPath
        : path.join(this.projectRoot, configuredHooksPath);
    } else if (isHusky) {
      hooksPath = huskyPath;
    } else {
      hooksPath = path.join(this.projectRoot, '.git', 'hooks');
    }

    return {
      isHusky,
      hooksPath
    };
  }

  /**
   * Check if ReDoc hook is properly installed
   */
  async isHookInstalled(): Promise<{ installed: boolean; path: string; issues: string[] }> {
    const issues: string[] = [];
    const config = await this.detectHooksConfig();
    
    const postCommitPath = path.join(config.hooksPath, 'post-commit');
    const REDOC_MARKER = '# ========== ReDoc';
    
    try {
      const content = await fs.readFile(postCommitPath, 'utf-8');
      
      // Check for ReDoc marker (new format) or just 'redoc' (old format)
      if (!content.includes(REDOC_MARKER) && !content.includes('redoc')) {
        issues.push('Hook exists but does not contain ReDoc section');
        return { installed: false, path: postCommitPath, issues };
      }

      // Check if executable
      const stats = await fs.stat(postCommitPath);
      const isExecutable = (stats.mode & 0o111) !== 0;
      if (!isExecutable) {
        issues.push('Hook file is not executable');
      }

      // Check if using proper background technique (nohup or setsid)
      if (!content.includes('nohup') && !content.includes('setsid')) {
        issues.push('Hook may not survive after git finishes (missing nohup/setsid)');
      }

      return { installed: issues.length === 0, path: postCommitPath, issues };
    } catch {
      issues.push(`Hook not found at ${postCommitPath}`);
      return { installed: false, path: postCommitPath, issues };
    }
  }

  /**
   * Get last commit information
   */
  async getLastCommitInfo(): Promise<CommitInfo> {
    const log = await this.git.log({ maxCount: 1 });
    const latest = log.latest;

    if (!latest) {
      throw new Error('No commits found');
    }

    const files = await this.getCommitFiles(latest.hash);

    return {
      hash: latest.hash,
      message: latest.message,
      author: latest.author_name,
      date: latest.date,
      files
    };
  }

  /**
   * Get files modified in a commit
   */
  async getCommitFiles(commitHash: string): Promise<string[]> {
    const diff = await this.git.show([
      commitHash,
      '--name-only',
      '--format='
    ]);

    return diff
      .split('\n')
      .filter(line => line.trim().length > 0);
  }

  /**
   * Get diff for a specific commit
   */
  async getDiffForCommit(commitHash: string): Promise<string> {
    const diff = await this.git.show([
      commitHash,
      '--format=',
      '--no-color'
    ]);

    return diff;
  }

  /**
   * Create submodule directory structure
   */
  async createSubmodule(submoduleName: string): Promise<string> {
    const submodulePath = path.join(this.projectRoot, submoduleName);

    // Create directory
    await fs.mkdir(submodulePath, { recursive: true });

    // Initialize git in submodule
    const submoduleGit = simpleGit(submodulePath);
    await submoduleGit.init();

    // Create initial README
    const readmePath = path.join(submodulePath, 'README.md');
    const readmeContent = `# ReDoc Documentation

This repository contains brain dumps and feature documentation.

Generated automatically by ReDoc.
`;
    await fs.writeFile(readmePath, readmeContent);

    // Create docs directory
    const docsDir = path.join(submodulePath, 'docs');
    await fs.mkdir(docsDir, { recursive: true });

    // Initial commit
    await submoduleGit.add('.');
    await submoduleGit.commit('Initial commit');

    // Add to .gitignore in main repo
    await this.addToGitignore(submoduleName);

    return submodulePath;
  }

  /**
   * Add entry to .gitignore
   */
  private async addToGitignore(entry: string): Promise<void> {
    const gitignorePath = path.join(this.projectRoot, '.gitignore');

    try {
      const content = await fs.readFile(gitignorePath, 'utf-8');

      // Check if entry already exists
      if (content.includes(entry)) {
        return;
      }

      await fs.appendFile(gitignorePath, `\n${entry}/\n`);
    } catch (error) {
      // .gitignore doesn't exist, create it
      await fs.writeFile(gitignorePath, `${entry}/\n`);
    }
  }

  /**
   * Sanitize branch name for use as directory/filename
   * Replaces / with -- to avoid path issues (e.g., feature/foo -> feature--foo)
   */
  private sanitizeBranchName(branch: string): string {
    return branch.replace(/\//g, '--');
  }

  /**
   * Create version file in submodule
   */
  async createVersionFile(
    submodulePath: string,
    branch: string,
    version: CommitVersion
  ): Promise<string> {
    const safeBranch = this.sanitizeBranchName(branch);
    const branchDir = path.join(submodulePath, safeBranch);
    await fs.mkdir(branchDir, { recursive: true });

    const versionFile = path.join(branchDir, `${version.version}.md`);
    const content = `# Version ${version.version}

**Commit:** ${version.commit}
**Message:** ${version.message}
**Timestamp:** ${version.timestamp}

## Files Modified
${version.files.map(f => `- ${f}`).join('\n')}

## Changes

\`\`\`diff
${version.diffs}
\`\`\`
`;

    await fs.writeFile(versionFile, content);
    return versionFile;
  }

  /**
   * Get all versions for a branch
   */
  async getBranchVersions(
    submodulePath: string,
    branch: string
  ): Promise<CommitVersion[]> {
    const safeBranch = this.sanitizeBranchName(branch);
    const branchDir = path.join(submodulePath, safeBranch);

    try {
      await fs.access(branchDir);
    } catch (error) {
      return [];
    }

    const files = await fs.readdir(branchDir);
    const versionFiles = files
      .filter(f => f.endsWith('.md') && f !== 'README.md')
      .sort((a, b) => {
        const versionA = parseFloat(a.replace('.md', ''));
        const versionB = parseFloat(b.replace('.md', ''));
        return versionA - versionB;
      });

    const versions: CommitVersion[] = [];

    for (const file of versionFiles) {
      const filePath = path.join(branchDir, file);
      const content = await fs.readFile(filePath, 'utf-8');

      // Parse version file content
      const commitMatch = content.match(/\*\*Commit:\*\* (.+)/);
      const messageMatch = content.match(/\*\*Message:\*\* (.+)/);
      const timestampMatch = content.match(/\*\*Timestamp:\*\* (.+)/);
      const diffsMatch = content.match(/```diff\n([\s\S]+?)\n```/);
      const filesMatch = content.match(/## Files Modified\n([\s\S]+?)\n\n/);

      if (commitMatch && messageMatch && timestampMatch) {
        const filesContent = filesMatch ? filesMatch[1] : '';
        const filesList = filesContent
          .split('\n')
          .filter(line => line.startsWith('- '))
          .map(line => line.substring(2));

        versions.push({
          version: file.replace('.md', ''),
          commit: commitMatch[1],
          message: messageMatch[1],
          timestamp: timestampMatch[1],
          diffs: diffsMatch ? diffsMatch[1] : '',
          files: filesList
        });
      }
    }

    return versions;
  }

  /**
   * Get next version number for branch
   */
  async getNextVersionNumber(
    submodulePath: string,
    branch: string
  ): Promise<string> {
    const versions = await this.getBranchVersions(submodulePath, branch);

    if (versions.length === 0) {
      return '1.0';
    }

    const lastVersion = versions[versions.length - 1].version;
    const [major, minor] = lastVersion.split('.').map(Number);

    return `${major}.${minor + 1}`;
  }

  /**
   * Install git hooks in the correct directory
   * Automatically detects custom hooksPath (like .githooks or .husky)
   * APPENDS to existing hooks instead of replacing them
   */
  async installHooks(hooksDir?: string): Promise<void> {
    // Auto-detect hooks directory if not provided
    let targetHooksDir: string;
    
    if (hooksDir) {
      targetHooksDir = hooksDir;
    } else {
      const config = await this.detectHooksConfig();
      targetHooksDir = config.hooksPath;
    }

    // Ensure hooks directory exists
    await fs.mkdir(targetHooksDir, { recursive: true });

    // Ensure log directory exists
    const { execSync } = await import('child_process');
    try {
      execSync('mkdir -p ~/.redoc', { encoding: 'utf-8' });
    } catch {
      // Ignore
    }

    // ReDoc snippet for post-commit (runs in background)
    // Uses robust path detection to find redoc in multiple locations
    const redocPostCommitSnippet = `
# ========== ReDoc post-commit hook ==========
# Find redoc in common locations
find_redoc() {
  for dir in "\$HOME/.bun/bin" "/opt/homebrew/bin" "/usr/local/bin" "\$HOME/.local/bin" "/usr/bin"; do
    if [ -x "\$dir/redoc" ]; then
      echo "\$dir/redoc"
      return 0
    fi
  done
  return 1
}

REDOC_CMD=\$(find_redoc)
if [ -z "\$REDOC_CMD" ]; then
  echo "[$(date)] ReDoc: comando nao encontrado" >> "\$HOME/.redoc/error.log"
  exit 0
fi

# Create log directory if needed
mkdir -p "\$HOME/.redoc"

# Run in background detached from terminal
(nohup "\$REDOC_CMD" post-commit >> "\$HOME/.redoc/post-commit.log" 2>&1 &) &
# ========== End ReDoc ==========
`;

    // ReDoc snippet for pre-push (runs synchronously - needs user interaction)
    const redocPrePushSnippet = `
# ========== ReDoc pre-push hook ==========
# Find redoc in common locations
find_redoc() {
  for dir in "\$HOME/.bun/bin" "/opt/homebrew/bin" "/usr/local/bin" "\$HOME/.local/bin" "/usr/bin"; do
    if [ -x "\$dir/redoc" ]; then
      echo "\$dir/redoc"
      return 0
    fi
  done
  return 1
}

REDOC_CMD=\$(find_redoc)
if [ -z "\$REDOC_CMD" ]; then
  echo "ReDoc: comando nao encontrado. Execute 'redoc doctor' para diagnosticar."
  exit 0
fi

# Create log directory if needed
mkdir -p "\$HOME/.redoc"

# IMPORTANT: git pre-push provides refs list on stdin.
# Drain stdin so it doesn't get consumed by interactive prompts.
while read -r local_ref local_sha remote_ref remote_sha; do
  :
done

# Run pre-push interactively using the controlling terminal.
# If no TTY is available (e.g., CI), skip to avoid breaking pushes.
if [ -r /dev/tty ] && [ -w /dev/tty ]; then
  "\$REDOC_CMD" pre-push < /dev/tty > /dev/tty 2> /dev/tty
else
  echo "[$(date)] ReDoc: sem TTY; pulando brain dump interativo" >> "\$HOME/.redoc/pre-push.log"
fi
# ========== End ReDoc ==========
`;

    // Install post-commit hook
    await this.appendToHook(
      path.join(targetHooksDir, 'post-commit'),
      redocPostCommitSnippet
    );

    // Install pre-push hook
    await this.appendToHook(
      path.join(targetHooksDir, 'pre-push'),
      redocPrePushSnippet
    );

    return;
  }

  /**
   * Append ReDoc snippet to an existing hook or create new hook
   */
  private async appendToHook(hookPath: string, snippet: string): Promise<void> {
    const REDOC_MARKER = '# ========== ReDoc';
    
    let existingContent = '';
    let hookExists = false;

    try {
      existingContent = await fs.readFile(hookPath, 'utf-8');
      hookExists = true;
    } catch {
      // Hook doesn't exist
    }

    // Check if ReDoc is already in the hook
    if (existingContent.includes(REDOC_MARKER)) {
      // Remove existing ReDoc section and add new one
      const lines = existingContent.split('\n');
      const newLines: string[] = [];
      let inRedocSection = false;

      for (const line of lines) {
        if (line.includes('# ========== ReDoc') && !line.includes('End ReDoc')) {
          inRedocSection = true;
          continue;
        }
        if (line.includes('# ========== End ReDoc')) {
          inRedocSection = false;
          continue;
        }
        if (!inRedocSection) {
          newLines.push(line);
        }
      }

      existingContent = newLines.join('\n');
    }

    // Build final content
    let finalContent: string;

    if (hookExists && existingContent.trim()) {
      // Append to existing hook
      finalContent = existingContent.trimEnd() + '\n' + snippet;
    } else {
      // Create new hook
      finalContent = `#!/bin/sh
${snippet}`;
    }

    await fs.writeFile(hookPath, finalContent);
    await fs.chmod(hookPath, 0o755);
  }

  /**
   * Configure git to use Husky hooks
   */
  async configureHusky(): Promise<void> {
    await this.git.addConfig('core.hooksPath', '.husky');
  }

  /**
   * Commit changes in submodule
   */
  async commitSubmodule(
    submodulePath: string,
    message: string
  ): Promise<void> {
    const submoduleGit = simpleGit(submodulePath);

    // Check if submodule is a valid git repository
    const isRepo = await submoduleGit.checkIsRepo();
    if (!isRepo) {
      // Initialize as git repository if not already
      await submoduleGit.init();
    }

    await submoduleGit.add('.');

    // Check if there are changes to commit
    const status = await submoduleGit.status();
    if (status.staged.length > 0 || status.files.length > 0) {
      await submoduleGit.commit(message);
    }
  }
}
