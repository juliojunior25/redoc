import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GitManager } from '../utils/git.js';
import { ConfigManager } from '../utils/config.js';
import { GroqManager } from '../utils/groq.js';
import type { RedocConfig } from '../types.js';

type ProviderId = 'groq' | 'gemini' | 'cerebras' | 'ollama';

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

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
    console.log(chalk.yellow('No git repository detected in this folder.'));
    const { doInit } = await inquirer.prompt([{
      type: 'confirm',
      name: 'doInit',
      message: 'Initialize git here now (git init)?',
      default: true
    }]);

    if (!doInit) {
      console.log(chalk.red('Error: A git repository is required to install hooks.'));
      process.exit(1);
    }

    const initSpinner = ora('Initializing git repository...').start();
    try {
      await gitManager.initRepository();
      // Ensure .git/hooks directory exists right after init
      const gitHooksDir = path.join(projectRoot, '.git', 'hooks');
      await fs.mkdir(gitHooksDir, { recursive: true });
      initSpinner.succeed('Git repository initialized');
    } catch (e) {
      initSpinner.fail('Failed to initialize git');
      throw e;
    }
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

  let docsPath: string;

  if (storageType === 'local') {
    const { folderName } = await inquirer.prompt([{
      type: 'input',
      name: 'folderName',
      message: 'Documentation folder name:',
      default: '.redoc',
      validate: (input) => input.trim().length > 0 || 'Folder name is required'
    }]);

    docsPath = folderName;

    // Create the docs directory
    const docsDir = path.join(projectRoot, docsPath);
    await fs.mkdir(docsDir, { recursive: true });
    console.log(chalk.green(`  ✓ Created ${folderName}/`));

  } else if (storageType === 'existing') {
    const { existingPath } = await inquirer.prompt([{
      type: 'input',
      name: 'existingPath',
      message: 'Path to existing folder/submodule (relative to project root):',
      default: '.redoc',
      validate: (input) => input.trim().length > 0 || 'Path is required'
    }]);

    docsPath = existingPath;

    // Ensure docs directory exists
    const docsDir = path.join(projectRoot, docsPath);
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
      default: '.redoc',
      validate: (input) => input.trim().length > 0 || 'Name is required'
    }]);

    const spinner = ora('Creating submodule...').start();
    try {
      docsPath = await gitManager.createSubmodule(newSubmoduleName);
      spinner.succeed(`Submodule created at ${newSubmoduleName}/`);
    } catch (error) {
      spinner.fail('Failed to create submodule');
      throw error;
    }
  }

  // AI provider
  const { aiProvider } = await inquirer.prompt([{
    type: 'list',
    name: 'aiProvider',
    message: 'Which AI provider do you want to use by default?',
    choices: [
      { name: 'Groq (API key)', value: 'groq' },
      { name: 'Gemini (Google API key)', value: 'gemini' },
      { name: 'Cerebras (API key)', value: 'cerebras' },
      { name: 'Ollama (local)', value: 'ollama' }
    ],
    default: 'groq'
  }]);

  let groqApiKey: string | undefined;
  let geminiApiKey: string | undefined;
  let cerebrasApiKey: string | undefined;
  let ollamaUrl: string | undefined;
  let ollamaModel: string | undefined;

  const configureGroq = async () => {
    const { hasKey } = await inquirer.prompt([{
      type: 'confirm',
      name: 'hasKey',
      message: 'Do you have a Groq API key?',
      default: false
    }]);
    if (hasKey) {
      const { apiKey } = await inquirer.prompt([{
        type: 'password',
        name: 'apiKey',
        message: 'Groq API key (starts with gsk_):',
        mask: '*',
        validate: (input) => {
          if (input.trim().length === 0) return 'API key is required';
          if (!GroqManager.validateApiKey(input)) return 'Invalid Groq API key format (should start with gsk_)';
          return true;
        }
      }]);
      groqApiKey = apiKey;
    } else {
      console.log(chalk.yellow('\nℹ️  You can add your Groq API key later with:'));
      console.log(chalk.gray('   redoc config set groqApiKey <key>'));
      console.log(chalk.gray('\n   Or set env var: GROQ_API_KEY\n'));
      console.log(chalk.gray('   Get your key at: https://console.groq.com\n'));
    }
  };

  const configureGemini = async () => {
    const { hasKey } = await inquirer.prompt([{
      type: 'confirm',
      name: 'hasKey',
      message: 'Do you have a Gemini (Google) API key?',
      default: false
    }]);
    if (hasKey) {
      const { apiKey } = await inquirer.prompt([{
        type: 'password',
        name: 'apiKey',
        message: 'Gemini API key:',
        mask: '*',
        validate: (input) => input.trim().length > 0 || 'API key is required'
      }]);
      geminiApiKey = apiKey;
    } else {
      console.log(chalk.yellow('\nℹ️  You can add your Gemini API key later with:'));
      console.log(chalk.gray('   redoc config set geminiApiKey <key>'));
      console.log(chalk.gray('\n   Or set env var: GOOGLE_API_KEY\n'));
    }
  };

  const configureCerebras = async () => {
    const { hasKey } = await inquirer.prompt([{
      type: 'confirm',
      name: 'hasKey',
      message: 'Do you have a Cerebras API key?',
      default: false
    }]);
    if (hasKey) {
      const { apiKey } = await inquirer.prompt([{
        type: 'password',
        name: 'apiKey',
        message: 'Cerebras API key:',
        mask: '*',
        validate: (input) => input.trim().length > 0 || 'API key is required'
      }]);
      cerebrasApiKey = apiKey;
    } else {
      console.log(chalk.yellow('\nℹ️  You can add your Cerebras API key later with:'));
      console.log(chalk.gray('   redoc config set cerebrasApiKey <key>'));
      console.log(chalk.gray('\n   Or set env var: CEREBRAS_API_KEY\n'));
    }
  };

  const configureOllama = async () => {
    const { url } = await inquirer.prompt([{
      type: 'input',
      name: 'url',
      message: 'Ollama URL:',
      default: 'http://localhost:11434',
      validate: (input) => input.trim().length > 0 || 'Ollama URL is required'
    }]);
    const { model } = await inquirer.prompt([{
      type: 'input',
      name: 'model',
      message: 'Ollama model name (must exist in `ollama list`):',
      default: 'llama3.1',
      validate: (input) => input.trim().length > 0 || 'Model name is required'
    }]);
    ollamaUrl = url;
    ollamaModel = model;
  };

  // Multi-provider setup: pick which providers to configure now.
  // Selecting a provider triggers its configuration prompts (so we can write credentials to config).
  const { providersToConfigure } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'providersToConfigure',
      message: 'Select providers to configure now (for fallback and per-task selection):',
      choices: [
        { name: 'Groq (API key)', value: 'groq' },
        { name: 'Gemini (Google API key)', value: 'gemini' },
        { name: 'Cerebras (API key)', value: 'cerebras' },
        { name: 'Ollama (local)', value: 'ollama' }
      ],
      default: [aiProvider],
      validate: (input) => {
        if (!Array.isArray(input) || input.length === 0) return 'Select at least one provider';
        if (!input.includes(aiProvider)) return 'Your default provider must be included';
        return true;
      }
    }
  ]);

  const selectedProviders = (Array.isArray(providersToConfigure) ? providersToConfigure : []) as ProviderId[];
  for (const p of selectedProviders) {
    if (p === 'groq') await configureGroq();
    if (p === 'gemini') await configureGemini();
    if (p === 'cerebras') await configureCerebras();
    if (p === 'ollama') await configureOllama();
  }

  // Build list of configured providers (only those with credentials/connection info)
  const configuredProviders = uniq([
    groqApiKey ? ('groq' as const) : null,
    geminiApiKey ? ('gemini' as const) : null,
    cerebrasApiKey ? ('cerebras' as const) : null,
    (ollamaUrl && ollamaModel) ? ('ollama' as const) : null
  ].filter(Boolean) as ProviderId[]);

  // Let user select + order fallback chain based on configured providers
  let providerOrder: ProviderId[] | undefined;
  if (configuredProviders.length > 0) {
    const { selectedProviders } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedProviders',
      message: 'Select providers for fallback (only configured providers are shown):',
      choices: configuredProviders.map(p => ({ name: p, value: p })),
      default: configuredProviders,
      validate: (input) => (Array.isArray(input) && input.length > 0) || 'Select at least one provider'
    }]);

    const set = (Array.isArray(selectedProviders) ? selectedProviders : []) as ProviderId[];

    if (set.length === 1) {
      providerOrder = set;
    } else {
      const remaining = [...set];
      const ordered: ProviderId[] = [];

      for (let i = 0; i < set.length; i++) {
        const { pick } = await inquirer.prompt([{
          type: 'list',
          name: 'pick',
          message: `Pick fallback provider #${i + 1}:`,
          choices: remaining,
          default: remaining.includes(aiProvider as ProviderId) ? (aiProvider as ProviderId) : remaining[0]
        }]);

        const chosen = pick as ProviderId;
        ordered.push(chosen);
        const idx = remaining.indexOf(chosen);
        if (idx !== -1) remaining.splice(idx, 1);
      }

      providerOrder = ordered;
    }
  }

  // Per-task provider selection (defaults to first in providerOrder, otherwise chosen aiProvider)
  const providerChoices = (providerOrder && providerOrder.length > 0) ? providerOrder : ([aiProvider] as ProviderId[]);
  const defaultTaskProvider = providerChoices[0] as ProviderId;

  const { analysisProvider, contentProvider, diagramsProvider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'analysisProvider',
      message: 'Provider for planning/analysis:',
      choices: providerChoices,
      default: defaultTaskProvider
    },
    {
      type: 'list',
      name: 'contentProvider',
      message: 'Provider for content generation:',
      choices: providerChoices,
      default: defaultTaskProvider
    },
    {
      type: 'list',
      name: 'diagramsProvider',
      message: 'Provider for diagram generation:',
      choices: providerChoices,
      default: defaultTaskProvider
    }
  ]);

  // Generation settings
  const { parallel } = await inquirer.prompt([{
    type: 'confirm',
    name: 'parallel',
    message: 'Enable parallel generation (content/diagram/table at the same time)?',
    default: false
  }]);

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
  - {TITLE}: Generated title (from branch/commit message)
  - {PROJECT_NAME}: Name of the project
  - {BRANCH_NAME}: Current branch name
  - {DATE}: Generation date
  - {CREATED_AT}: Generation date (same as {DATE})
  - {GENERATED_AT}: Full timestamp
  - {COMMIT_COUNT}: Number of commits
  - {COMMITS_SUMMARY}: Summary of commits
  - {COMMITS_LIST}: Alias of {COMMITS_SUMMARY}
  - {BRAIN_DUMP}: Brain dump answers
  - {WHAT_AND_WHY}: Single section content
  - {KEY_DECISIONS}: Single section content
  - {GOTCHAS}: Single section content
  - {ADDITIONAL_CONTEXT}: Single section content
  - {CHANGES_DETAIL}: Detailed changes from commits
  - {FILES_LIST}: List of modified files

  Feel free to customize this template as you wish.
  The sections below are suggestions - modify or remove as needed.
-->

## Overview

{BRAIN_DUMP}

## Changes Summary

{COMMITS_SUMMARY}

## Technical Details

{CHANGES_DETAIL}

## Files

{FILES_LIST}

---
*Generated by ReDoc on {GENERATED_AT}*
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
      docsPath,
      groqApiKey
    );

    // Add editor preference and template path
    const configManager = new ConfigManager(projectRoot);
    const updates: Partial<RedocConfig> = {};

    if (editorChoice) {
      updates.editor = editorChoice;
    }

    if (templatePath) {
      updates.templatePath = templatePath;
    }

    updates.aiProvider = aiProvider;
    updates.generation = {
      parallel: Boolean(parallel),
      providerOrder,
      providers: {
        analysis: analysisProvider,
        content: contentProvider,
        diagrams: diagramsProvider
      }
    };

    if (geminiApiKey) updates.geminiApiKey = geminiApiKey;
    if (cerebrasApiKey) updates.cerebrasApiKey = cerebrasApiKey;
    if (ollamaUrl) updates.ollamaUrl = ollamaUrl;
    if (ollamaModel) updates.ollamaModel = ollamaModel;

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
