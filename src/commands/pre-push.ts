import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { GitManager } from '../utils/git.js';
import { ConfigManager } from '../utils/config.js';
import { GroqManager } from '../utils/groq.js';
import { DocumentGenerator } from '../utils/document.js';
import { BrainDumpAnswers } from '../types.js';

/**
 * Normalize text to handle special characters and encoding issues
 */
function normalizeText(text: string): string {
  if (!text) return '';

  return text
    // Normalize unicode (NFD -> NFC for proper accents)
    .normalize('NFC')
    // Remove null bytes
    .replace(/\0/g, '')
    // Normalize line endings to LF
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove control characters except newlines and tabs
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

/**
 * Pre-push hook - interactive brain dump session
 */
export async function prePushCommand(): Promise<void> {
  console.log(chalk.blue.bold('\n💭 ReDoc - Brain Dump Time\n'));

  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();

    // Set editor preference
    if (config.editor) {
      process.env.EDITOR = config.editor;
    }

    const gitManager = new GitManager();
    const branch = await gitManager.getCurrentBranch();

    // Load pending versions
    const spinner = ora('Checking commits...').start();
    const versions = await gitManager.getBranchVersions(
      config.submodulePath,
      branch
    );

    if (versions.length === 0) {
      spinner.info('No commits to document.');
      console.log(chalk.gray('Make some commits first, then push.\n'));
      return;
    }

    spinner.succeed(`Found ${versions.length} commit(s) on branch "${branch}"`);

    // Show commits
    console.log(chalk.gray('\nCommits to document:'));
    versions.forEach(v => {
      const shortHash = v.commit.substring(0, 7);
      console.log(chalk.gray(`  • ${shortHash} - ${v.message}`));
    });
    console.log();

    // Ask if wants to document
    const { shouldDocument } = await inquirer.prompt([{
      type: 'confirm',
      name: 'shouldDocument',
      message: `Create brain dump for these ${versions.length} commit(s)?`,
      default: true
    }]);

    if (!shouldDocument) {
      console.log(chalk.yellow('Skipped. Documentation will be requested on next push.\n'));
      return;
    }

    // Generate questions with Groq
    let questions;
    let usedAI = false;

    if (config.groqApiKey) {
      const apiSpinner = ora('Generating contextual questions...').start();
      try {
        const groqManager = new GroqManager(config.groqApiKey);
        questions = await groqManager.generateQuestions(versions);
        apiSpinner.succeed('Questions generated');
        usedAI = true;
      } catch (error) {
        apiSpinner.warn('AI failed, using default questions');
        const { DEFAULT_QUESTIONS } = await import('../templates/feature-report');
        questions = DEFAULT_QUESTIONS;
      }
    } else {
      console.log(chalk.yellow('ℹ️  Using default questions (no Groq API key configured)'));
      const { DEFAULT_QUESTIONS } = await import('../templates/feature-report');
      questions = DEFAULT_QUESTIONS;
    }

    // Collect answers
    console.log(chalk.blue.bold('\n📝 Brain Dump Questions\n'));
    console.log(chalk.gray('Answer concisely (2-5 lines each). AI will expand your answers.\n'));

    const rawAnswers: BrainDumpAnswers = {
      what_and_why: '',
      key_decisions: '',
      gotchas: '',
      additional_context: ''
    };

    for (const question of questions) {
      // Show context if available
      if (question.context && usedAI) {
        console.log(chalk.cyan(`💡 ${question.context}\n`));
      }

      try {
        const { answer } = await inquirer.prompt([{
          type: 'editor',
          name: 'answer',
          message: question.question,
          default: '',
          postprocess: (input: string) => normalizeText(input),
          validate: (input) => {
            if (!input || input.trim().length === 0) {
              return 'Please provide an answer (even if brief)';
            }
            return true;
          }
        }]);

        rawAnswers[question.id] = normalizeText(answer);
      } catch (editorError) {
        // Fallback to simple input if editor fails
        console.log(chalk.yellow('\n⚠ Editor failed, using simple input instead'));
        const { answer } = await inquirer.prompt([{
          type: 'input',
          name: 'answer',
          message: `${question.question} (single line):`,
          validate: (input) => {
            if (!input || input.trim().length === 0) {
              return 'Please provide an answer (even if brief)';
            }
            return true;
          }
        }]);

        rawAnswers[question.id] = normalizeText(answer);
      }
    }

    // Refine answers with AI
    let answers = rawAnswers;

    if (config.groqApiKey) {
      const refineSpinner = ora('Refining answers with AI...').start();
      try {
        const groqManager = new GroqManager(config.groqApiKey);
        answers = await groqManager.refineAnswers(versions, rawAnswers) as BrainDumpAnswers;
        refineSpinner.succeed('Answers refined by AI');
      } catch (error) {
        refineSpinner.warn('Using original answers');
      }
    }

    // Generate document
    const docSpinner = ora('Generating documentation...').start();
    const documentGenerator = new DocumentGenerator();

    // Load custom template if configured
    await documentGenerator.loadTemplate(config);

    const document = await documentGenerator.generate(
      branch,
      versions,
      answers
    );

    const filePath = await documentGenerator.save(
      document,
      config.submodulePath
    );

    docSpinner.succeed('Documentation generated');

    // Success
    console.log(chalk.green.bold('\n✅ Brain dump captured!\n'));
    console.log(chalk.blue('Document saved to:'));
    console.log(chalk.gray(`  ${filePath}\n`));

  } catch (error) {
    console.log(chalk.red('\n❌ Error during brain dump:\n'));
    console.error(error);
    process.exit(1);
  }
}
