import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs/promises';
import * as path from 'path';

import { ConfigManager } from '../utils/config.js';
import { GitManager } from '../utils/git.js';
import { DocumentGenerator, QAPair } from '../utils/document.js';
import { detectTrivialChange } from '../utils/trivial.js';
import { parseRichResponse } from '../utils/response-parser.js';
import { generateQuestions, planDocument, generateMainContent, generateDiagram, generateTable } from '../ai/orchestrator.js';

function normalizeText(text: string): string {
  if (!text) return '';

  return text
    .normalize('NFC')
    .replace(/\0/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

async function safeRmDir(dir: string): Promise<void> {
  try {
    // Bun supports fs.rm; Node 18+ as well.
    await fs.rm(dir, { recursive: true, force: true } as any);
  } catch {
    // ignore
  }
}

/**
 * Final report generator based on captured commit diffs.
 *
 * This exists to support the workflow:
 * - post-commit captures each commit diff into docsPath/.commits
 * - post-push generates the final report from those captured commits
 */
export async function postPushCommand(options: { skip?: boolean; offline?: boolean; verbose?: boolean } = {}): Promise<void> {
  console.log(chalk.blue.bold('\n🧾 ReDoc - Final Report (from captured commits)\n'));

  const configManager = new ConfigManager();
  const config = await configManager.load();
  const docsRoot = configManager.resolveDocsPath(config);
  const captureRoot = path.join(docsRoot, '.commits');

  if (options.skip) {
    console.log(chalk.yellow('Skipped (via --skip).'));
    return;
  }

  const gitManager = new GitManager();
  const spinner = ora('Loading captured commits...').start();
  const branch = await gitManager.getCurrentBranch();
  const versions = await gitManager.getBranchVersions(captureRoot, branch);
  spinner.stop();

  if (versions.length === 0) {
    console.log(chalk.gray('No captured commits found.'));
    console.log(chalk.gray(`Nothing to do. (Expected captures under ${captureRoot})\n`));
    return;
  }

  const commits = versions.map(v => ({ hash: v.commit, message: v.message }));
  const files = Array.from(new Set(versions.flatMap(v => v.files))).sort();
  const diff = versions.map(v => `# ${v.commit.substring(0, 7)} - ${v.message}\n\n${v.diffs}`).join('\n\n');

  spinner.succeed(`Loaded ${versions.length} captured commit(s) on "${branch}"`);

  const trivial = detectTrivialChange([
    {
      commitMessage: commits[0]?.message || 'captured commits',
      files,
      diff
    }
  ]);
  if (trivial.isTrivial) {
    console.log(chalk.gray(`\nTrivial change, skipping report${trivial.reason ? ` (${trivial.reason})` : ''}.\n`));
    return;
  }

  const { shouldGenerate } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'shouldGenerate',
      message: `Generate final report for ${versions.length} captured commit(s)?`,
      default: true
    }
  ]);
  if (!shouldGenerate) {
    console.log(chalk.yellow('Skipped.\n'));
    return;
  }

  const offline = Boolean(options.offline);

  const qSpinner = ora('Generating questions...').start();
  const questionResult = offline
    ? {
        questions: [
          'What problem does this change solve, and why now?',
          'What alternatives did you consider, and why did you choose this approach?'
        ],
        provider: 'offline' as const
      }
    : await generateQuestions({
        config,
        ctx: { branch, commits, files, diff },
        preferredProvider: config.aiProvider
      });
  qSpinner.succeed(`Questions generated (${questionResult.questions.length})${options.verbose ? ` via ${questionResult.provider}` : ''}`);

  console.log(chalk.blue.bold(`\n📝 Questions (${questionResult.questions.length})\n`));
  console.log(chalk.gray('Tip: You can paste Markdown, code blocks, Mermaid diagrams, and tables.'));
  console.log(chalk.gray('Empty answer = skip the question.\n'));

  const qa: QAPair[] = [];
  for (let i = 0; i < questionResult.questions.length; i++) {
    const q = questionResult.questions[i];
    console.log(chalk.blue(`📝 ${i + 1}/${questionResult.questions.length}: ${q}`));

    let answerText = '';
    try {
      const { answer } = await inquirer.prompt([
        {
          type: 'editor',
          name: 'answer',
          message: q,
          default: '',
          postprocess: (input: string) => normalizeText(input)
        }
      ]);
      answerText = normalizeText(answer);
    } catch {
      const { answer } = await inquirer.prompt([
        {
          type: 'input',
          name: 'answer',
          message: `${q} (single line):`
        }
      ]);
      answerText = normalizeText(answer);
    }

    if (answerText.trim().length > 0) {
      qa.push({ question: q, answer: answerText });
    }
    console.log();
  }

  const genSpinner = ora(`Generating final report...${config.generation?.parallel ? ' (parallel)' : ''}`).start();

  const parsedAll = qa.map(p => parseRichResponse(p.answer));
  const hasDeveloperDiagrams = parsedAll.some(p => p.mermaidBlocks.length > 0);
  const hasDeveloperTables = parsedAll.some(p => p.tables.length > 0);

  const planResult = offline
    ? {
        plan: {
          shouldGenerateDiagram: false,
          diagramRationale: null,
          diagramType: null,
          diagramFocus: null,
          shouldGenerateTable: false,
          tableRationale: null,
          tableType: null,
          sections: ['Summary', 'Notes'],
          complexity: 'minimal',
          skipGeneration: true,
          skipReason: 'Offline mode'
        },
        provider: 'offline' as const
      }
    : await planDocument({
        config,
        ctx: { branch, commits, files, diff },
        qa,
        hasDeveloperDiagrams,
        hasDeveloperTables,
        preferredProvider: config.generation?.providers?.analysis
      });

  if (options.verbose) {
    genSpinner.info(
      `Plan: complexity=${planResult.plan.complexity}, sections=${planResult.plan.sections.join(', ')}, diagram=${planResult.plan.shouldGenerateDiagram}, table=${planResult.plan.shouldGenerateTable}${planResult.provider ? ` (via ${planResult.provider})` : ''}`
    );
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
    const filePath = await documentGenerator.save(document, docsRoot, { versionDocs: config.versionDocs !== false });
    genSpinner.succeed('Final report saved');
    console.log(chalk.green.bold('\n✅ Final report saved!\n'));
    console.log(chalk.gray(`→ ${filePath}\n`));
    return;
  }

  const ctx = { branch, commits, files, diff };
  const doParallel = Boolean(config.generation?.parallel);
  const tasks = {
    content: () => generateMainContent({ config, ctx, qa, plan: planResult.plan, preferredProvider: config.generation?.providers?.content }),
    diagram: () => generateDiagram({ config, qa, plan: planResult.plan, preferredProvider: config.generation?.providers?.diagrams }),
    table: () => generateTable({ config, qa, plan: planResult.plan, preferredProvider: config.generation?.providers?.content })
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

  const filePath = await documentGenerator.save(document, docsRoot, { versionDocs: config.versionDocs !== false });
  genSpinner.succeed('Final report saved');
  console.log(chalk.green.bold('\n✅ Final report saved!\n'));
  console.log(chalk.gray(`→ ${filePath}\n`));

  // Clear captured commits for this branch to avoid reusing them next time.
  const safeBranch = branch.replace(/\//g, '--');
  await safeRmDir(path.join(captureRoot, safeBranch));
}
