import inquirer from 'inquirer';
import chalk from 'chalk';
import { ConfigManager } from '../utils/config.js';
import { GroqManager } from '../utils/groq.js';

/**
 * Manage ReDoc configuration
 */
export async function configCommand(
  action?: string,
  key?: string,
  value?: string
): Promise<void> {
  const configManager = new ConfigManager();

  try {
    // If no action provided, show interactive menu
    if (!action) {
      await showConfigMenu(configManager);
      return;
    }

    // Handle specific actions
    switch (action) {
      case 'show':
        await showConfig(configManager);
        break;

      case 'get':
        if (!key) {
          console.log(chalk.red('Error: Key is required for "get" action'));
          console.log(chalk.gray('Usage: redoc config get <key>'));
          process.exit(1);
        }
        await getConfigValue(configManager, key);
        break;

      case 'set':
        if (!key || !value) {
          console.log(chalk.red('Error: Key and value are required for "set" action'));
          console.log(chalk.gray('Usage: redoc config set <key> <value>'));
          process.exit(1);
        }
        await setConfigValue(configManager, key, value);
        break;

      default:
        console.log(chalk.red(`Error: Unknown action "${action}"`));
        console.log(chalk.gray('Available actions: show, get, set'));
        process.exit(1);
    }

  } catch (error: any) {
    if (error.message?.includes('not initialized')) {
      console.log(chalk.red('❌ ReDoc not initialized.\n'));
      console.log(chalk.gray('Run "redoc init" to get started.\n'));
    } else {
      console.log(chalk.red('❌ Error:\n'));
      console.error(error);
    }
    process.exit(1);
  }
}

/**
 * Show interactive configuration menu
 */
async function showConfigMenu(configManager: ConfigManager): Promise<void> {
  const config = await configManager.load();

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: 'What do you want to do?',
    choices: [
      { name: 'View configuration', value: 'show' },
      { name: 'Set Groq API key', value: 'setGroqKey' },
      { name: 'Change project name', value: 'setProjectName' },
      { name: 'Exit', value: 'exit' }
    ]
  }]);

  switch (action) {
    case 'show':
      await showConfig(configManager);
      break;

    case 'setGroqKey':
      const { apiKey } = await inquirer.prompt([{
        type: 'password',
        name: 'apiKey',
        message: 'Groq API key:',
        mask: '*',
        validate: (input) => {
          if (!GroqManager.validateApiKey(input)) {
            return 'Invalid Groq API key (should start with gsk_)';
          }
          return true;
        }
      }]);

      await configManager.setGroqApiKey(apiKey);
      console.log(chalk.green('\n✓ Groq API key updated\n'));
      break;

    case 'setProjectName':
      const { projectName } = await inquirer.prompt([{
        type: 'input',
        name: 'projectName',
        message: 'Project name:',
        default: config.projectName,
        validate: (input) => input.trim().length > 0 || 'Required'
      }]);

      await configManager.update({ projectName });
      console.log(chalk.green('\n✓ Project name updated\n'));
      break;

    case 'exit':
      break;
  }
}

/**
 * Show current configuration
 */
async function showConfig(configManager: ConfigManager): Promise<void> {
  const config = await configManager.getConfig();

  console.log(chalk.blue.bold('\n⚙️  ReDoc Configuration\n'));
  console.log(chalk.gray('Project name:    ') + chalk.white(config.projectName));
  console.log(chalk.gray('Submodule path:  ') + chalk.white(config.submodulePath));
  console.log(chalk.gray('AI Provider:     ') + chalk.white(config.aiProvider || 'groq'));
  console.log(chalk.gray('Groq API key:    ') + chalk.white(
    config.groqApiKey ? `${config.groqApiKey.substring(0, 10)}...` : 'Not set'
  ));
  console.log(chalk.gray('Editor:          ') + chalk.white(config.editor || 'System default'));

  if (config.currentBranch) {
    console.log(chalk.gray('Current branch:  ') + chalk.white(config.currentBranch));
  }

  console.log();
}

/**
 * Get specific configuration value
 */
async function getConfigValue(
  configManager: ConfigManager,
  key: string
): Promise<void> {
  const config = await configManager.getConfig();

  if (!(key in config)) {
    console.log(chalk.red(`Error: Unknown configuration key "${key}"`));
    process.exit(1);
  }

  const value = (config as any)[key];
  console.log(value || '');
}

/**
 * Set specific configuration value
 */
async function setConfigValue(
  configManager: ConfigManager,
  key: string,
  value: string
): Promise<void> {
  // Validate key
  const validKeys = ['projectName', 'groqApiKey', 'aiProvider', 'openaiApiKey', 'editor'];

  if (!validKeys.includes(key)) {
    console.log(chalk.red(`Error: Invalid configuration key "${key}"`));
    console.log(chalk.gray('Valid keys: ' + validKeys.join(', ')));
    process.exit(1);
  }

  // Special validation for Groq API key
  if (key === 'groqApiKey' && !GroqManager.validateApiKey(value)) {
    console.log(chalk.red('Error: Invalid Groq API key format'));
    console.log(chalk.gray('API key should start with "gsk_"'));
    process.exit(1);
  }

  // Update configuration
  await configManager.update({ [key]: value });

  console.log(chalk.green(`✓ Configuration updated: ${key} = ${value}`));
}
