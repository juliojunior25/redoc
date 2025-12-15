#!/usr/bin/env bun

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { postCommitCommand } from './commands/post-commit.js';
import { postPushCommand } from './commands/post-push.js';
import { prePushCommand } from './commands/pre-push.js';
import { statusCommand } from './commands/status.js';
import { configCommand } from './commands/config.js';
import { doctorCommand } from './commands/doctor.js';
import { fixHooksCommand } from './commands/fix-hooks.js';
import { templateCommand } from './commands/template.js';
import { runCommandWithOptions } from './commands/run.js';
import { searchCommand } from './commands/search.js';
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

// Run command (manual trigger)
program
  .command('run')
  .description('Manual trigger (same as pre-push hook)')
  .option('--skip', 'Skip this run (no questions)')
  .option('--offline', 'Use default questions, no AI')
  .option('--verbose', 'Show extra debug output')
  .action(async (options) => {
    try {
      await runCommandWithOptions(options);
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

// Post-push (manual) - generates final report from captured commits
program
  .command('post-push')
  .description('Generate a final report from captured commits (manual workflow)')
  .option('--skip', 'Skip this run (no questions)')
  .option('--offline', 'Use default questions, no AI')
  .option('--verbose', 'Show extra debug output')
  .action(async (options) => {
    try {
      await postPushCommand(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Pre-push hook
program
  .command('pre-push')
  .description('Pre-push hook - interactive brain dump session')
  .option('--skip', 'Skip this push (no questions)')
  .option('--offline', 'Use default questions, no AI')
  .option('--verbose', 'Show extra debug output')
  .action(async (options) => {
    try {
      await prePushCommand(options);
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

// Search command
program
  .command('search <query>')
  .description('Search for text in ReDoc docs')
  .action(async (query) => {
    try {
      await searchCommand(query);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
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

// Template command
program
  .command('template')
  .description('Edit the documentation template')
  .action(async () => {
    try {
      await templateCommand();
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
  console.log('  $ redoc run                           Manual brain dump (like pre-push)');
  console.log('  $ redoc search <query>                Search in generated docs');
  console.log('  $ redoc pre-push                      Manual brain dump');
  console.log('  $ redoc template                      Edit documentation template');
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
