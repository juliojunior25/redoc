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

  // Ask about submodule
  const { useExistingSubmodule } = await inquirer.prompt([{
    type: 'confirm',
    name: 'useExistingSubmodule',
    message: 'Do you have an existing ReDoc submodule/repository?',
    default: false
  }]);

  let submodulePath: string;

  if (useExistingSubmodule) {
    const { existingPath } = await inquirer.prompt([{
      type: 'input',
      name: 'existingPath',
      message: 'Path to existing submodule (relative to project root):',
      default: 'redocs',
      validate: (input) => input.trim().length > 0 || 'Path is required'
    }]);

    submodulePath = path.join(projectRoot, existingPath);

    // Ensure docs directory exists inside the submodule
    const docsDir = path.join(submodulePath, 'docs');
    try {
      await fs.mkdir(docsDir, { recursive: true });
      console.log(chalk.gray(`   Created docs directory at ${docsDir}`));
    } catch (error) {
      // Directory might already exist, that's fine
    }
  } else {
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

  // Create configuration
  const spinner = ora('Saving configuration...').start();
  try {
    await ConfigManager.createInitialConfig(
      projectRoot,
      projectName,
      submodulePath,
      groqApiKey
    );

    // Add editor preference
    if (editorChoice) {
      const configManager = new ConfigManager(projectRoot);
      await configManager.update({ editor: editorChoice });
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
}
