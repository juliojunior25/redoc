import chalk from 'chalk';
import { GitManager } from '../utils/git.js';
import { ConfigManager } from '../utils/config.js';
import { DocumentGenerator } from '../utils/document.js';

/**
 * Show ReDoc status - pending commits and existing docs
 */
export async function statusCommand(): Promise<void> {
  console.log(chalk.blue.bold('\n📊 ReDoc Status\n'));

  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();

    const gitManager = new GitManager();
    const branch = await gitManager.getCurrentBranch();

    console.log(chalk.blue('Configuration:'));
    console.log(chalk.gray(`  Project: ${config.projectName}`));
    console.log(chalk.gray(`  Submodule: ${config.submodulePath}`));
    console.log(chalk.gray(`  Current branch: ${branch}`));
    console.log(chalk.gray(`  Groq API: ${config.groqApiKey ? '✓ Configured' : '✗ Not configured'}\n`));

    // Get pending versions
    const versions = await gitManager.getBranchVersions(
      config.submodulePath,
      branch
    );

    if (versions.length > 0) {
      console.log(chalk.yellow(`⏳ Pending commits (${versions.length}):\n`));
      versions.forEach(v => {
        const shortHash = v.commit.substring(0, 7);
        const date = new Date(v.timestamp).toLocaleDateString();
        console.log(chalk.gray(`  ${v.version}. ${shortHash} - ${v.message}`));
        console.log(chalk.gray(`     ${date} • ${v.files.length} file(s) changed\n`));
      });

      console.log(chalk.blue('💡 Run "redoc pre-push" to create brain dump for these commits.\n'));
    } else {
      console.log(chalk.green('✓ No pending commits on this branch.\n'));
    }

    // List existing documentation
    const documentGenerator = new DocumentGenerator();
    const docs = await documentGenerator.listDocuments(config.submodulePath);

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
