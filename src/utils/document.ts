import * as fs from 'fs/promises';
import * as path from 'path';
import { CommitVersion, FinalDocument, BrainDumpAnswers } from '../types.js';
import { FEATURE_REPORT_TEMPLATE } from '../templates/feature-report.js';

/**
 * Generates final documentation from brain dump answers
 */
export class DocumentGenerator {
  /**
   * Generate final document from answers
   */
  async generate(
    branch: string,
    versions: CommitVersion[],
    answers: BrainDumpAnswers
  ): Promise<FinalDocument> {
    const title = this.generateTitle(branch, versions);
    const content = this.formatDocument(branch, versions, answers);

    return {
      title,
      branch,
      content,
      metadata: {
        createdAt: new Date().toISOString(),
        commits: versions.map(v => v.commit),
        versions: versions.length
      }
    };
  }

  /**
   * Sanitize branch name for use as directory/filename
   * Replaces / with -- to avoid path issues
   */
  private sanitizeBranchName(branch: string): string {
    return branch.replace(/\//g, '--');
  }

  /**
   * Save document to submodule
   */
  async save(document: FinalDocument, submodulePath: string): Promise<string> {
    const docsDir = path.join(submodulePath, 'docs');
    
    // Sanitize branch name to avoid path issues (e.g., feature/foo -> feature--foo)
    const safeBranch = this.sanitizeBranchName(document.branch);
    
    // Create branch-specific directory inside docs
    const branchDir = path.join(docsDir, safeBranch);
    await fs.mkdir(branchDir, { recursive: true });

    // Generate filename from branch and timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${safeBranch}-${timestamp}.md`;
    const filePath = path.join(branchDir, filename);

    await fs.writeFile(filePath, document.content, 'utf-8');

    return filePath;
  }

  /**
   * Format document using template
   */
  private formatDocument(
    branch: string,
    versions: CommitVersion[],
    answers: BrainDumpAnswers
  ): string {
    let content = FEATURE_REPORT_TEMPLATE;

    // Replace metadata
    content = content.replace('{{title}}', this.generateTitle(branch, versions));
    content = content.replace('{{branch}}', branch);
    content = content.replace('{{createdAt}}', new Date().toLocaleDateString());
    content = content.replace('{{commitCount}}', versions.length.toString());
    content = content.replace('{{generatedAt}}', new Date().toLocaleString());

    // Replace answers
    content = content.replace('{{what_and_why}}', this.formatAnswer(answers.what_and_why));
    content = content.replace('{{key_decisions}}', this.formatAnswer(answers.key_decisions));
    content = content.replace('{{gotchas}}', this.formatAnswer(answers.gotchas));
    content = content.replace('{{additional_context}}', this.formatAnswer(answers.additional_context));

    // Replace appendix
    content = content.replace('{{appendix_commits}}', this.formatCommits(versions));
    content = content.replace('{{appendix_files}}', this.formatFiles(versions));

    return content;
  }

  /**
   * Generate title from branch and commits
   */
  private generateTitle(branch: string, versions: CommitVersion[]): string {
    if (versions.length === 0) {
      return `Feature: ${branch}`;
    }

    // Try to extract feature name from first commit message
    const firstMessage = versions[0].message;
    const match = firstMessage.match(/^(feat|feature|fix|refactor)[:\/]\s*(.+)/i);

    if (match) {
      return match[2].charAt(0).toUpperCase() + match[2].slice(1);
    }

    return `Feature: ${branch}`;
  }

  /**
   * Format answer text
   */
  private formatAnswer(answer: string): string {
    if (!answer || answer.trim().length === 0) {
      return '_No information provided._';
    }

    return answer.trim();
  }

  /**
   * Format commits for appendix
   */
  private formatCommits(versions: CommitVersion[]): string {
    return versions.map(v => {
      const shortHash = v.commit.substring(0, 7);
      return `- **${shortHash}** - ${v.message} _(${new Date(v.timestamp).toLocaleDateString()})_`;
    }).join('\n');
  }

  /**
   * Format files for appendix
   */
  private formatFiles(versions: CommitVersion[]): string {
    // Collect all unique files
    const allFiles = new Set<string>();

    versions.forEach(v => {
      v.files.forEach(f => allFiles.add(f));
    });

    const filesList = Array.from(allFiles).sort();

    if (filesList.length === 0) {
      return '_No files modified._';
    }

    return filesList.map(f => `- \`${f}\``).join('\n');
  }

  /**
   * Read existing document
   */
  async read(filePath: string): Promise<string> {
    return await fs.readFile(filePath, 'utf-8');
  }

  /**
   * List all documents in submodule (searches in branch subdirectories)
   */
  async listDocuments(submodulePath: string): Promise<string[]> {
    const docsDir = path.join(submodulePath, 'docs');
    const documents: string[] = [];

    try {
      const entries = await fs.readdir(docsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Look for .md files inside branch directories
          const branchDir = path.join(docsDir, entry.name);
          const files = await fs.readdir(branchDir);
          
          for (const file of files) {
            if (file.endsWith('.md')) {
              documents.push(`${entry.name}/${file}`);
            }
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          // Also support flat structure for backwards compatibility
          documents.push(entry.name);
        }
      }

      return documents.sort().reverse(); // Most recent first
    } catch (error) {
      return [];
    }
  }

  /**
   * Get document info from filename
   */
  static parseFilename(filename: string): { branch: string; date: string } | null {
    const match = filename.match(/^(.+)-(\d{4}-\d{2}-\d{2})\.md$/);

    if (!match) {
      return null;
    }

    return {
      branch: match[1],
      date: match[2]
    };
  }
}
