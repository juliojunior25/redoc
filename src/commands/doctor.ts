import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GitManager } from '../utils/git.js';
import { ConfigManager } from '../utils/config.js';

/**
 * Diagnose ReDoc installation and hooks
 */
export async function doctorCommand(): Promise<void> {
  console.log(chalk.blue.bold('\n🩺 ReDoc Doctor - Diagnostics\n'));

  const gitManager = new GitManager();
  const configManager = new ConfigManager();

  let hasIssues = false;

  // Check 1: Git repository
  const spinner1 = ora('Checking git repository...').start();
  const isGitRepo = await gitManager.isGitRepository();
  if (isGitRepo) {
    spinner1.succeed('Git repository detected');
  } else {
    spinner1.fail('Not a git repository');
    hasIssues = true;
    return;
  }

  // Check 2: ReDoc initialized
  const spinner2 = ora('Checking ReDoc configuration...').start();
  const isInitialized = await configManager.isInitialized();
  if (isInitialized) {
    spinner2.succeed('ReDoc is initialized');
  } else {
    spinner2.fail('ReDoc not initialized - run: redoc init');
    hasIssues = true;
    return;
  }

  // Check 3: Hooks configuration
  const spinner3 = ora('Checking hooks configuration...').start();
  const hooksConfig = await gitManager.detectHooksConfig();
  if (hooksConfig.isHusky) {
    spinner3.succeed(`Husky detected - hooks path: ${hooksConfig.hooksPath}`);
  } else {
    spinner3.succeed(`Native git hooks - path: ${hooksConfig.hooksPath}`);
  }

  // Check 4: Hook installed correctly
  const spinner4 = ora('Checking post-commit hook...').start();
  const hookStatus = await gitManager.isHookInstalled();
  if (hookStatus.installed) {
    spinner4.succeed(`Hook installed at: ${hookStatus.path}`);
  } else {
    spinner4.fail(`Hook issues found:`);
    hookStatus.issues.forEach(issue => {
      console.log(chalk.yellow(`   ⚠️  ${issue}`));
    });
    hasIssues = true;
  }

  // Check 5: redoc command in PATH
  const spinner5 = ora('Checking redoc in PATH...').start();
  try {
    const { execSync } = await import('child_process');
    const redocPath = execSync('which redoc', { encoding: 'utf-8' }).trim();
    spinner5.succeed(`redoc found at: ${redocPath}`);
  } catch {
    spinner5.fail('redoc not found in PATH');
    console.log(chalk.yellow('   ⚠️  Hooks may fail to find the redoc command'));
    console.log(chalk.gray('   Try running: npm link (in the redoc directory)'));
    hasIssues = true;
  }

  // Check 6: Test hook execution environment
  const spinner6 = ora('Checking hook execution environment...').start();
  try {
    const { execSync } = await import('child_process');
    
    // Check if setsid is available (Linux/macOS)
    let hasSetsid = false;
    try {
      execSync('which setsid', { encoding: 'utf-8' });
      hasSetsid = true;
    } catch {
      // setsid not available
    }

    if (hasSetsid) {
      spinner6.succeed('setsid available for background process detachment');
    } else {
      spinner6.warn('setsid not available - using nohup fallback (OK for macOS)');
    }
  } catch {
    spinner6.warn('Could not check execution environment');
  }

  // Check 7: Look at recent logs (now in ~/.redoc/)
  console.log(chalk.blue('\n📋 Recent hook logs:\n'));
  
  const homeDir = process.env.HOME || '~';
  const logPath = path.join(homeDir, '.redoc', 'post-commit.log');
  try {
    const logContent = await fs.readFile(logPath, 'utf-8');
    const lines = logContent.split('\n').filter(l => l.trim()).slice(-10);
    if (lines.length > 0) {
      lines.forEach(line => console.log(chalk.gray(`   ${line}`)));
    } else {
      console.log(chalk.gray('   (log file empty)'));
    }
  } catch {
    console.log(chalk.gray('   (no log file found at ~/.redoc/post-commit.log)'));
  }

  // Summary
  console.log('');
  if (hasIssues) {
    console.log(chalk.yellow.bold('⚠️  Issues found - see details above\n'));
    
    console.log(chalk.blue('🔧 Suggested fixes:\n'));
    
    if (!hookStatus.installed) {
      console.log(chalk.gray('   1. Fix hooks (preserves existing hooks):'));
      console.log(chalk.white('      redoc fix-hooks'));
      console.log('');
    }
    
    console.log(chalk.gray('   2. Manual test:'));
    console.log(chalk.white('      redoc post-commit'));
    console.log('');
    
    console.log(chalk.gray('   3. Check hook manually:'));
    console.log(chalk.white(`      cat ${hookStatus.path}`));
    console.log(chalk.white(`      ${hookStatus.path}`));
    console.log('');
  } else {
    console.log(chalk.green.bold('✅ All checks passed!\n'));
    console.log(chalk.gray('If commits are still not being captured, try:'));
    console.log(chalk.gray('   1. Make a test commit'));
    console.log(chalk.gray('   2. Wait a few seconds'));
    console.log(chalk.gray('   3. Run: redoc status'));
    console.log('');
  }
}
