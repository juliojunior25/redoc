import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GitManager } from '../utils/git.js';
import { ConfigManager } from '../utils/config.js';
import { GroqManager } from '../utils/groq.js';

/**
 * Initialize ReDoc in a project
 */
export async function initCommand(): Promise<void> {
  console.log(chalk.blue.bold('\n🚀 ReDoc Initialization\n'));

  const gitManager = new GitManager();
  const configManager = new ConfigManager();

  // Check if already initialized
  const isInitialized = await configManager.isInitialized();
  if (isInitialized) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'ReDoc is already initialized. Reinitialize?',
      default: false
    }]);

    if (!confirm) {
      console.log(chalk.yellow('Aborted.'));
      return;
    }

    await configManager.delete();
  }

  // Check if git repository
  const isGitRepo = await gitManager.isGitRepository();
  if (!isGitRepo) {
    console.log(chalk.red('Error: Not a git repository. Initialize git first.'));
    process.exit(1);
  }

  // Get project name
  const projectRoot = process.cwd();
  const defaultProjectName = path.basename(projectRoot);

  const { projectName } = await inquirer.prompt([{
    type: 'input',
    name: 'projectName',
    message: 'Project name:',
    default: defaultProjectName,
    validate: (input) => input.trim().length > 0 || 'Project name is required'
  }]);

  // Ask about storage type
  const { storageType } = await inquirer.prompt([{
    type: 'list',
    name: 'storageType',
    message: 'Where do you want to store documentation?',
    choices: [
      { name: 'Local folder (inside this project)', value: 'local' },
      { name: 'Git submodule (separate repository)', value: 'submodule' },
      { name: 'Use existing folder/submodule', value: 'existing' }
    ],
    default: 'local'
  }]);

  let submodulePath: string;

  if (storageType === 'local') {
    const { folderName } = await inquirer.prompt([{
      type: 'input',
      name: 'folderName',
      message: 'Documentation folder name:',
      default: 'docs',
      validate: (input) => input.trim().length > 0 || 'Folder name is required'
    }]);

    submodulePath = path.join(projectRoot, folderName);

    // Create the docs directory
    const docsDir = path.join(submodulePath, 'docs');
    await fs.mkdir(docsDir, { recursive: true });
    console.log(chalk.green(`  ✓ Created ${folderName}/docs/`));

  } else if (storageType === 'existing') {
    const { existingPath } = await inquirer.prompt([{
      type: 'input',
      name: 'existingPath',
      message: 'Path to existing folder/submodule (relative to project root):',
      default: 'docs',
      validate: (input) => input.trim().length > 0 || 'Path is required'
    }]);

    submodulePath = path.join(projectRoot, existingPath);

    // Ensure docs directory exists
    const docsDir = path.join(submodulePath, 'docs');
    try {
      await fs.mkdir(docsDir, { recursive: true });
    } catch {
      // Directory might already exist
    }
    console.log(chalk.green(`  ✓ Using ${existingPath}/`));

  } else {
    // submodule
    const { newSubmoduleName } = await inquirer.prompt([{
      type: 'input',
      name: 'newSubmoduleName',
      message: 'Name for new documentation submodule:',
      default: 'redocs',
      validate: (input) => input.trim().length > 0 || 'Name is required'
    }]);

    const spinner = ora('Creating submodule...').start();
    try {
      submodulePath = await gitManager.createSubmodule(newSubmoduleName);
      spinner.succeed(`Submodule created at ${newSubmoduleName}/`);
    } catch (error) {
      spinner.fail('Failed to create submodule');
      throw error;
    }
  }

  // Get Groq API key
  const { hasGroqKey } = await inquirer.prompt([{
    type: 'confirm',
    name: 'hasGroqKey',
    message: 'Do you have a Groq API key?',
    default: false
  }]);

  let groqApiKey: string | undefined;

  if (hasGroqKey) {
    const { apiKey } = await inquirer.prompt([{
      type: 'password',
      name: 'apiKey',
      message: 'Groq API key (starts with gsk_):',
      mask: '*',
      validate: (input) => {
        if (input.trim().length === 0) {
          return 'API key is required';
        }
        if (!GroqManager.validateApiKey(input)) {
          return 'Invalid Groq API key format (should start with gsk_)';
        }
        return true;
      }
    }]);

    groqApiKey = apiKey;
  } else {
    console.log(chalk.yellow('\nℹ️  You can add your Groq API key later with:'));
    console.log(chalk.gray('   redoc config set groqApiKey <key>'));
    console.log(chalk.gray('\n   Get your key at: https://console.groq.com\n'));
  }

  // Ask about editor preference
  const { editorChoice } = await inquirer.prompt([{
    type: 'list',
    name: 'editorChoice',
    message: 'Which editor to use for brain dump answers?',
    choices: [
      { name: 'VS Code (code --wait)', value: 'code --wait' },
      { name: 'Cursor (cursor --wait)', value: 'cursor --wait' },
      { name: 'Vim', value: 'vim' },
      { name: 'Nano', value: 'nano' },
      { name: 'System default ($EDITOR)', value: '' }
    ],
    default: 'code --wait'
  }]);

  // Ask about custom template
  const { customizeTemplate } = await inquirer.prompt([{
    type: 'confirm',
    name: 'customizeTemplate',
    message: 'Do you want to customize the documentation template?',
    default: false
  }]);

  let templatePath: string | undefined;

  if (customizeTemplate) {
    const templateFile = '.redoc-template.md';
    templatePath = path.join(projectRoot, templateFile);

    // Create default template file
    const defaultTemplate = `# {PROJECT_NAME} - Documentation

<!--
  ReDoc Custom Template

  Available variables:
  - {PROJECT_NAME}: Name of the project
  - {BRANCH_NAME}: Current branch name
  - {DATE}: Generation date
  - {COMMITS_SUMMARY}: Summary of commits
  - {BRAIN_DUMP}: Brain dump answers
  - {CHANGES_DETAIL}: Detailed changes from commits

  Feel free to customize this template as you wish.
  The sections below are suggestions - modify or remove as needed.
-->

## Overview

{BRAIN_DUMP}

## Changes Summary

{COMMITS_SUMMARY}

## Technical Details

{CHANGES_DETAIL}

---
*Generated by ReDoc on {DATE}*
`;

    await fs.writeFile(templatePath, defaultTemplate, 'utf-8');
    console.log(chalk.green(`\n✓ Template created at ${templateFile}`));
    console.log(chalk.gray('  Edit this file to customize your documentation output'));
    console.log(chalk.gray('  Run "redoc template" anytime to edit the template\n'));
  }

  // Create configuration
  const spinner = ora('Saving configuration...').start();
  try {
    await ConfigManager.createInitialConfig(
      projectRoot,
      projectName,
      submodulePath,
      groqApiKey
    );

    // Add editor preference and template path
    const configManager = new ConfigManager(projectRoot);
    const updates: Record<string, string> = {};

    if (editorChoice) {
      updates.editor = editorChoice;
    }

    if (templatePath) {
      updates.templatePath = templatePath;
    }

    if (Object.keys(updates).length > 0) {
      await configManager.update(updates);
    }

    spinner.succeed('Configuration saved');
  } catch (error) {
    spinner.fail('Failed to save configuration');
    throw error;
  }

  // Detect hooks configuration (custom hooksPath, Husky, or native)
  const hooksConfig = await gitManager.detectHooksConfig();
  
  console.log('');
  if (hooksConfig.isHusky) {
    console.log(chalk.yellow('⚠️  Detected Husky in project'));
    console.log(chalk.gray(`   Hooks path: ${hooksConfig.hooksPath}\n`));
  } else if (!hooksConfig.hooksPath.includes('.git/hooks')) {
    console.log(chalk.yellow('⚠️  Detected custom hooks path'));
    console.log(chalk.gray(`   Hooks path: ${hooksConfig.hooksPath}\n`));
  }

  // Ask to install hooks
  const { installHooks } = await inquirer.prompt([{
    type: 'confirm',
    name: 'installHooks',
    message: `Install git hooks in ${hooksConfig.hooksPath}?`,
    default: true
  }]);

  if (installHooks) {
    const hookSpinner = ora('Installing git hooks...').start();
    try {
      // installHooks will auto-detect the correct path
      await gitManager.installHooks();
      hookSpinner.succeed(`Git hooks installed in ${hooksConfig.hooksPath}`);

      // Verify hooks installation
      const hookStatus = await gitManager.isHookInstalled();
      if (hookStatus.installed) {
        console.log(chalk.green('  ✓ post-commit hook verified'));
      } else {
        console.log(chalk.yellow('  ⚠ Hook installed but may have issues:'));
        hookStatus.issues.forEach(issue => {
          console.log(chalk.gray(`    - ${issue}`));
        });
      }

      // Check if redoc is accessible
      let redocAccessible = false;
      const searchPaths = [
        `${process.env.HOME}/.bun/bin`,
        '/opt/homebrew/bin',
        '/usr/local/bin',
        `${process.env.HOME}/.local/bin`,
      ];

      for (const dir of searchPaths) {
        try {
          await fs.access(`${dir}/redoc`);
          redocAccessible = true;
          console.log(chalk.green(`  ✓ redoc found at ${dir}/redoc`));
          break;
        } catch {
          // Continue searching
        }
      }

      if (!redocAccessible) {
        console.log(chalk.yellow('\n  ⚠ redoc not found in common paths'));
        console.log(chalk.gray('    Run: bun link (in redoc directory) to install globally'));
      }
    } catch (error) {
      hookSpinner.fail('Failed to install git hooks');
      throw error;
    }
  }

  // Success message
  console.log(chalk.green.bold('\n✅ ReDoc initialized successfully!\n'));
  console.log(chalk.blue('Next steps:'));
  console.log(chalk.gray('  1. Make commits as usual'));
  console.log(chalk.gray('  2. Before pushing, answer brain dump questions'));
  console.log(chalk.gray('  3. Documentation will be generated automatically\n'));

  console.log(chalk.blue('Commands:'));
  console.log(chalk.gray('  redoc status       - View pending commits'));
  console.log(chalk.gray('  redoc config       - Manage configuration'));
  console.log(chalk.gray('  redoc pre-push     - Manual brain dump\n'));

  if (installHooks) {
    console.log(chalk.blue('Tip:'));
    console.log(chalk.gray('  Make a test commit to verify hooks are working:'));
    console.log(chalk.gray('    git commit --allow-empty -m "test: verify redoc hooks"\n'));
  }
}
