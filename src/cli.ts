#!/usr/bin/env bun

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { postCommitCommand } from './commands/post-commit.js';
import { prePushCommand } from './commands/pre-push.js';
import { statusCommand } from './commands/status.js';
import { configCommand } from './commands/config.js';
import { doctorCommand } from './commands/doctor.js';
import { fixHooksCommand } from './commands/fix-hooks.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
const version = packageJson.version;

const program = new Command();

program
  .name('redoc')
  .description('Capture developer brain dumps via git hooks and AI-generated questions')
  .version(version);

// Init command
program
  .command('init')
  .description('Initialize ReDoc in the current project')
  .action(async () => {
    try {
      await initCommand();
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Post-commit hook
program
  .command('post-commit')
  .description('Post-commit hook - captures commit information (internal use)')
  .action(async () => {
    await postCommitCommand();
  });

// Pre-push hook
program
  .command('pre-push')
  .description('Pre-push hook - interactive brain dump session')
  .action(async () => {
    try {
      await prePushCommand();
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show pending commits and documentation status')
  .action(async () => {
    await statusCommand();
  });

// Config command
program
  .command('config [action] [key] [value]')
  .description('Manage ReDoc configuration')
  .action(async (action, key, value) => {
    await configCommand(action, key, value);
  });

// Doctor command
program
  .command('doctor')
  .description('Diagnose ReDoc installation and hooks')
  .action(async () => {
    try {
      await doctorCommand();
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Fix hooks command
program
  .command('fix-hooks')
  .description('Reinstall git hooks in the correct location')
  .action(async () => {
    try {
      await fixHooksCommand();
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Help text
program.on('--help', () => {
  console.log('');
  console.log('Examples:');
  console.log('  $ redoc init                          Initialize ReDoc');
  console.log('  $ redoc status                        View pending commits');
  console.log('  $ redoc config                        Interactive config menu');
  console.log('  $ redoc config show                   Show configuration');
  console.log('  $ redoc config set groqApiKey <key>   Set Groq API key');
  console.log('  $ redoc pre-push                      Manual brain dump');
  console.log('  $ redoc doctor                        Diagnose hook issues');
  console.log('  $ redoc fix-hooks                     Reinstall hooks');
  console.log('');
  console.log('Get your Groq API key at: https://console.groq.com');
  console.log('');
});

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
