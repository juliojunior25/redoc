import chalk from 'chalk';
import { prePushCommand } from './pre-push.js';

/**
 * Manual trigger (same behavior as pre-push hook).
 */
export async function runCommand(): Promise<void> {
  console.log(chalk.gray('Running ReDoc manually (equivalent to pre-push)...'));
  await prePushCommand();
}

export async function runCommandWithOptions(options: { skip?: boolean; offline?: boolean; verbose?: boolean; exportQuestions?: string; answers?: string } = {}): Promise<void> {
  console.log(chalk.gray('Running ReDoc manually (equivalent to pre-push)...'));
  await prePushCommand(options);
}
