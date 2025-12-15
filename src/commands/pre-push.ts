import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GitManager } from '../utils/git.js';
import { ConfigManager } from '../utils/config.js';
import { DocumentGenerator, QAPair } from '../utils/document.js';
import { detectTrivialChange } from '../utils/trivial.js';
import { parseRichResponse } from '../utils/response-parser.js';
import { generateQuestions, planDocument, generateMainContent, generateDiagram, generateTable } from '../ai/orchestrator.js';

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
 * Check if we have a valid interactive TTY
 */
function hasInteractiveTTY(): boolean {
  try {
    // Check if stdin/stdout are TTYs
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return false;
    }
    // Additional check for Bun compatibility
    if (typeof process.stdin.setRawMode !== 'function') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Pre-push hook - interactive brain dump session
 */
export async function prePushCommand(options: { skip?: boolean; offline?: boolean; verbose?: boolean } = {}): Promise<void> {
  // Early TTY check - exit silently if no interactive terminal
  if (!hasInteractiveTTY()) {
    // Log to file for debugging, but don't crash
    const logDir = path.join(process.env.HOME || '~', '.redoc');
    try {
      await fs.mkdir(logDir, { recursive: true });
      await fs.appendFile(
        path.join(logDir, 'pre-push.log'),
        `[${new Date().toISOString()}] Skipped: no interactive TTY available\n`
      );
    } catch {
      // Ignore logging errors
    }
    return;
  }

  console.log(chalk.blue.bold('\n💭 ReDoc - Brain Dump Time\n'));

  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();
    const docsPath = configManager.resolveDocsPath(config);

    if (options.skip) {
      console.log(chalk.yellow('Skipped (via --skip).'));
      return;
    }

    // Set editor preference
    if (config.editor) {
      process.env.EDITOR = config.editor;
    }

    const gitManager = new GitManager();
    const spinner = ora('Loading captured commits...').start();
    const branch = await gitManager.getCurrentBranch();
    const captureRoot = path.join(docsPath, '.commits');
    const versions = await gitManager.getBranchVersions(captureRoot, branch);
    spinner.stop();

    if (versions.length === 0) {
      console.log(chalk.gray('\nNo captured commits found for this branch.\n'));
      console.log(chalk.gray(`Expected captures under: ${path.join(captureRoot, branch.replace(/\//g, '--'))}`));
      console.log(chalk.gray('Make a commit (with hooks installed) and try again.\n'));
      return;
    }

    const commits = versions.map(v => ({ hash: v.commit, message: v.message }));
    const files = Array.from(new Set(versions.flatMap(v => v.files))).sort();
    const diff = versions.map(v => `# ${v.commit.substring(0, 7)} - ${v.message}\n\n${v.diffs}`).join('\n\n');

    spinner.succeed(`Loaded ${versions.length} captured commit(s) on "${branch}"`);

    // Trivial detection
    const trivial = detectTrivialChange(
      [{
        commitMessage: commits[0]?.message || 'captured commits',
        files,
        diff
      }]
    );
    if (trivial.isTrivial) {
      console.log(chalk.gray(`\nTrivial change, skipping brain dump${trivial.reason ? ` (${trivial.reason})` : ''}.\n`));
      return;
    }

    console.log(chalk.gray('\nCaptured commits:'));
    commits.forEach(c => {
      const shortHash = c.hash.substring(0, 7);
      console.log(chalk.gray(`  • ${shortHash} - ${c.message}`));
    });
    console.log();

    if (options.verbose) {
      console.log(chalk.gray(`Files changed (${files.length}):`));
      files.slice(0, 50).forEach(f => console.log(chalk.gray(`  - ${f}`)));
      if (files.length > 50) {
        console.log(chalk.gray(`  ... and ${files.length - 50} more`));
      }
      console.log();
    }

    const { shouldDocument } = await inquirer.prompt([{
      type: 'confirm',
      name: 'shouldDocument',
      message: `Create brain dump for these ${versions.length} captured commit(s)?`,
      default: true
    }]);
    if (!shouldDocument) {
      console.log(chalk.yellow('Skipped.\n'));
      return;
    }

    // Generate questions
    const offline = Boolean(options.offline);
    const apiSpinner = ora('Generating brain dump questions...').start();
    const questionResult = offline
      ? { questions: [
          'What was the trigger for this change? What problem were you actually solving?',
          'What approaches did you try or consider before landing on this solution?',
          'What\'s the trickiest part of this code that someone might break without realizing?'
        ], provider: 'offline' as const }
      : await generateQuestions({
          config,
          ctx: {
            branch,
            commits,
            files,
            diff
          },
          preferredProvider: config.aiProvider
        });
    apiSpinner.succeed(`Brain dump questions ready (${questionResult.questions.length})${options.verbose ? ` via ${questionResult.provider}` : ''}`);

    const questions = questionResult.questions;

    console.log(chalk.blue.bold(`\n🧠 Brain Dump Session (${questions.length} questions)\n`));
    console.log(chalk.gray('Goal: Capture knowledge that would be LOST if you left tomorrow.'));
    console.log(chalk.gray('Think: decisions, gotchas, context, lessons learned.'));
    console.log(chalk.gray(''));
    console.log(chalk.gray('Tips:'));
    console.log(chalk.gray('  • Be honest about shortcuts, hacks, and tech debt'));
    console.log(chalk.gray('  • Mention what you tried that DIDN\'T work'));
    console.log(chalk.gray('  • Warn about fragile areas or edge cases'));
    console.log(chalk.gray('  • Empty answer = skip the question'));
    console.log();

    const qa: QAPair[] = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      console.log(chalk.blue(`📝 ${i + 1}/${questions.length}: ${q}`));

      let answerText = '';

      try {
        const { answer } = await inquirer.prompt([{
          type: 'editor',
          name: 'answer',
          message: q,
          default: '',
          postprocess: (input: string) => normalizeText(input)
        }]);
        answerText = normalizeText(answer);
      } catch {
        const { answer } = await inquirer.prompt([{
          type: 'input',
          name: 'answer',
          message: `${q} (single line):`
        }]);
        answerText = normalizeText(answer);
      }

      if (answerText.trim().length > 0) {
        qa.push({ question: q, answer: answerText });
      }
      console.log();
    }

    // Planner + generation (optional parallel)
    const genSpinner = ora(`Generating document...${config.generation?.parallel ? ' (parallel)' : ''}`).start();

    // Detect developer-provided diagrams/tables from answers
    const parsedAll = qa.map(p => parseRichResponse(p.answer));
    const hasDeveloperDiagrams = parsedAll.some(p => p.mermaidBlocks.length > 0);
    const hasDeveloperTables = parsedAll.some(p => p.tables.length > 0);

    const planResult = offline
      ? { plan: { shouldGenerateDiagram: false, diagramRationale: null, diagramType: null, diagramFocus: null, shouldGenerateTable: false, tableRationale: null, tableType: null, sections: ['Summary', 'Notes'], complexity: 'minimal', skipGeneration: true, skipReason: 'Offline mode' }, provider: 'offline' as const }
      : await planDocument({
          config,
          ctx: { branch, commits, files, diff },
          qa,
          hasDeveloperDiagrams,
          hasDeveloperTables,
          preferredProvider: config.generation?.providers?.analysis
        });

    if (options.verbose) {
      const p = planResult.plan;
      genSpinner.info(`AI Analysis (via ${planResult.provider}):`);
      console.log(chalk.gray(`  • Complexity: ${p.complexity}`));
      console.log(chalk.gray(`  • Diagram: ${p.shouldGenerateDiagram ? `YES (${p.diagramType}) - ${p.diagramRationale}` : 'No'}`));
      console.log(chalk.gray(`  • Table: ${p.shouldGenerateTable ? `YES (${p.tableType}) - ${p.tableRationale}` : 'No'}`));
      if (p.keyInsights && p.keyInsights.length > 0) {
        console.log(chalk.gray(`  • Key insights: ${p.keyInsights.join('; ')}`));
      }
      genSpinner.start();
    }

    if (planResult.plan.skipGeneration) {
      const documentGenerator = new DocumentGenerator();
      const document = await documentGenerator.generateFromQA({
        branch,
        commits,
        files,
        qa,
        language: config.language || 'en'
      });

      const filePath = await documentGenerator.save(document, docsPath, { versionDocs: config.versionDocs !== false });

      genSpinner.succeed('Brain dump saved');
      console.log(chalk.green.bold('\n✅ Brain dump saved!\n'));
      console.log(chalk.gray(`→ ${filePath}\n`));

      // Clear captured commits for this branch to avoid reusing them next time.
      try {
        const safeBranch = branch.replace(/\//g, '--');
        await fs.rm(path.join(captureRoot, safeBranch), { recursive: true, force: true } as any);
      } catch {
        // ignore
      }
      return;
    }

    const doParallel = Boolean(config.generation?.parallel);

    const ctx = { branch, commits, files, diff };

    const tasks = {
      content: () => generateMainContent({ config, ctx, qa, plan: planResult.plan, preferredProvider: config.generation?.providers?.content }),
      diagram: () => generateDiagram({ config, ctx, qa, plan: planResult.plan, preferredProvider: config.generation?.providers?.diagrams }),
      table: () => generateTable({ config, ctx, qa, plan: planResult.plan, preferredProvider: config.generation?.providers?.content })
    };

    const [contentRes, diagramRes, tableRes] = doParallel
      ? await Promise.all([tasks.content(), tasks.diagram(), tasks.table()])
      : [await tasks.content(), await tasks.diagram(), await tasks.table()];

    const documentGenerator = new DocumentGenerator();
    const document = await documentGenerator.generateFromGeneratedParts({
      branch,
      commits,
      files,
      qa,
      language: config.language || 'en',
      mainContentMarkdown: contentRes.markdown,
      aiDiagram: diagramRes.mermaid,
      aiTable: tableRes.table,
      plan: planResult.plan
    });

    const filePath = await documentGenerator.save(document, docsPath, { versionDocs: config.versionDocs !== false });

    genSpinner.succeed('Brain dump saved');
    console.log(chalk.green.bold('\n✅ Brain dump saved!\n'));
    console.log(chalk.gray(`→ ${filePath}\n`));

    // Clear captured commits for this branch to avoid reusing them next time.
    try {
      const safeBranch = branch.replace(/\//g, '--');
      await fs.rm(path.join(captureRoot, safeBranch), { recursive: true, force: true } as any);
    } catch {
      // ignore
    }

  } catch (error) {
    console.log(chalk.red('\n❌ Error during brain dump:\n'));
    console.error(error);
    process.exit(1);
  }
}
