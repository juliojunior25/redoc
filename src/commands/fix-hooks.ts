import chalk from 'chalk';
import ora from 'ora';
import { GitManager } from '../utils/git.js';
import { ConfigManager } from '../utils/config.js';

/**
 * Fix/reinstall ReDoc hooks
 */
export async function fixHooksCommand(): Promise<void> {
  console.log(chalk.blue.bold('\n🔧 ReDoc Fix Hooks\n'));

  const gitManager = new GitManager();
  const configManager = new ConfigManager();

  // Check if git repository
  const isGitRepo = await gitManager.isGitRepository();
  if (!isGitRepo) {
    console.log(chalk.red('Error: Not a git repository.'));
    process.exit(1);
  }

  // Check if ReDoc is initialized
  const isInitialized = await configManager.isInitialized();
  if (!isInitialized) {
    console.log(chalk.red('Error: ReDoc not initialized. Run: redoc init'));
    process.exit(1);
  }

  // Detect hooks configuration
  const hooksConfig = await gitManager.detectHooksConfig();
  
  console.log(chalk.gray(`Detected hooks path: ${hooksConfig.hooksPath}`));
  if (hooksConfig.isHusky) {
    console.log(chalk.gray('Husky detected: Yes'));
  }
  console.log('');

  // Install hooks
  const spinner = ora('Installing hooks...').start();
  try {
    await gitManager.installHooks();
    spinner.succeed(`Hooks installed in ${hooksConfig.hooksPath}`);
  } catch (error) {
    spinner.fail('Failed to install hooks');
    console.error(chalk.red(String(error)));
    process.exit(1);
  }

  // Verify installation
  const hookStatus = await gitManager.isHookInstalled();
  if (hookStatus.installed) {
    console.log(chalk.green('\n✅ Hooks fixed successfully!'));
    console.log(chalk.gray('\nTest with a commit or run: redoc post-commit'));
  } else {
    console.log(chalk.yellow('\n⚠️  Hook installed but with warnings:'));
    hookStatus.issues.forEach(issue => {
      console.log(chalk.yellow(`   - ${issue}`));
    });
  }
  console.log('');
}
