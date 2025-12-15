import chalk from 'chalk';
import { GitManager } from '../utils/git.js';
import { ConfigManager } from '../utils/config.js';
import { DocumentGenerator } from '../utils/document.js';
import * as path from 'path';

/**
 * Show ReDoc status - pending commits and existing docs
 */
export async function statusCommand(): Promise<void> {
  console.log(chalk.blue.bold('\n📊 ReDoc Status\n'));

  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();
    const docsPath = configManager.resolveDocsPath(config);

    const gitManager = new GitManager();
    const branch = await gitManager.getCurrentBranch();

    console.log(chalk.blue('Configuration:'));
    console.log(chalk.gray(`  Project: ${config.projectName}`));
    console.log(chalk.gray(`  Docs path: ${config.docsPath || config.submodulePath || '.redoc'}`));
    console.log(chalk.gray(`  Current branch: ${branch}`));
    console.log(chalk.gray(`  Groq API: ${config.groqApiKey ? '✓ Configured' : '✗ Not configured'}\n`));

    // Canonical flow: show captured commits pending a final report
    const captureRoot = path.join(docsPath, '.commits');
    const versions = await gitManager.getBranchVersions(captureRoot, branch);

    if (versions.length > 0) {
      console.log(chalk.yellow(`⏳ Captured commits pending report (${versions.length}):\n`));
      versions.forEach(v => {
        const shortHash = v.commit.substring(0, 7);
        console.log(chalk.gray(`  • ${shortHash} - ${v.message} (${v.version})`));
      });
      console.log();
      console.log(chalk.blue('💡 Run "redoc pre-push" (or "redoc run") to generate the final report.\n'));
    } else {
      console.log(chalk.green('✓ No captured commits pending a report on this branch.\n'));
    }

    // List existing documentation
    const documentGenerator = new DocumentGenerator();
    const docs = await documentGenerator.listDocuments(docsPath);

    if (docs.length > 0) {
      console.log(chalk.blue(`📄 Existing documentation (${docs.length}):\n`));

      docs.slice(0, 5).forEach(doc => {
        const info = DocumentGenerator.parseFilename(doc);
        if (info) {
          console.log(chalk.gray(`  • ${info.branch} (${info.date})`));
        } else {
          console.log(chalk.gray(`  • ${doc}`));
        }
      });

      if (docs.length > 5) {
        console.log(chalk.gray(`  ... and ${docs.length - 5} more\n`));
      } else {
        console.log();
      }
    } else {
      console.log(chalk.gray('📄 No documentation yet.\n'));
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
