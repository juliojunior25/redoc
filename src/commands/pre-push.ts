import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { GitManager } from '../utils/git.js';
import { ConfigManager } from '../utils/config.js';
import { GroqManager } from '../utils/groq.js';
import { DocumentGenerator } from '../utils/document.js';
import { BrainDumpAnswers } from '../types.js';

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

      const { answer } = await inquirer.prompt([{
        type: 'editor',
        name: 'answer',
        message: question.question,
        default: '',
        validate: (input) => {
          if (!input || input.trim().length === 0) {
            return 'Please provide an answer (even if brief)';
          }
          return true;
        }
      }]);

      rawAnswers[question.id] = answer.trim();
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

    // Commit to submodule
    const commitSpinner = ora('Committing to submodule...').start();
    await gitManager.commitSubmodule(
      config.submodulePath,
      `Brain dump: ${branch} (${versions.length} commits)`
    );
    commitSpinner.succeed('Committed to submodule');

    // Success
    console.log(chalk.green.bold('\n✅ Brain dump captured!\n'));
    console.log(chalk.blue('Document saved to:'));
    console.log(chalk.gray(`  ${filePath}\n`));
    console.log(chalk.gray('Review the document and push your changes.\n'));

  } catch (error) {
    console.log(chalk.red('\n❌ Error during brain dump:\n'));
    console.error(error);
    process.exit(1);
  }
}
