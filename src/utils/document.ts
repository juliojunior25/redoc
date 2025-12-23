import * as fs from 'fs/promises';
import * as path from 'path';
import { CommitVersion, FinalDocument, BrainDumpAnswers, RedocConfig } from '../types.js';
import { FEATURE_REPORT_TEMPLATE } from '../templates/feature-report.js';
import { parseRichResponse } from './response-parser.js';
import type { DocumentPlan } from '../ai/types.js';

export interface QAPair {
  question: string;
  answer: string;
}

/**
 * Generates final documentation from brain dump answers
 */
export class DocumentGenerator {
  private customTemplate: string | null = null;
  private projectName: string = '';

  /**
   * Load custom template if configured
   */
  async loadTemplate(config: RedocConfig): Promise<void> {
    this.projectName = config.projectName;

    if (config.templatePath) {
      try {
        this.customTemplate = await fs.readFile(config.templatePath, 'utf-8');
      } catch {
        // Template file not found, use default
        this.customTemplate = null;
      }
    }
  }

  /**
   * Generate final document from answers
   */
  async generate(
    branch: string,
    versions: CommitVersion[],
    answers: BrainDumpAnswers
  ): Promise<FinalDocument> {
    const title = this.generateTitle(branch, versions);
    const content = this.customTemplate
      ? this.formatWithCustomTemplate(branch, versions, answers)
      : this.formatDocument(branch, versions, answers);

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
   * PRD-style document generation: assemble from diff context + Q&A pairs.
   */
  async generateFromQA(
    params: {
      branch: string;
      commits: Array<{ hash: string; message: string }>;
      files: string[];
      qa: QAPair[];
      language?: 'en' | 'pt-BR' | 'es';
    }
  ): Promise<FinalDocument> {
    const title = this.generateTitleFromCommits(params.branch, params.commits);
    const content = this.assembleMarkdown({
      title,
      branch: params.branch,
      commits: params.commits,
      files: params.files,
      qa: params.qa,
      language: params.language || 'en'
    });

    return {
      title,
      branch: params.branch,
      content,
      metadata: {
        createdAt: new Date().toISOString(),
        commits: params.commits.map(c => c.hash),
        versions: params.commits.length
      }
    };
  }

  /**
   * PRD-style generation using orchestrator-generated parts.
   * Keeps developer Q&A (and extracted code/tables/urls), and optionally injects
   * AI-written content plus AI diagram/table when requested by the plan.
   */
  async generateFromGeneratedParts(params: {
    branch: string;
    commits: Array<{ hash: string; message: string }>;
    files: string[];
    qa: QAPair[];
    language?: 'en' | 'pt-BR' | 'es';
    mainContentMarkdown: string;
    aiDiagram: string | null;
    aiTable: string | null;
    plan: DocumentPlan;
  }): Promise<FinalDocument> {
    const title = this.generateTitleFromCommits(params.branch, params.commits);
    const content = this.assembleMarkdownFromParts({
      title,
      branch: params.branch,
      commits: params.commits,
      files: params.files,
      qa: params.qa,
      language: params.language || 'en',
      mainContentMarkdown: params.mainContentMarkdown,
      aiDiagram: params.aiDiagram,
      aiTable: params.aiTable,
      plan: params.plan
    });

    return {
      title,
      branch: params.branch,
      content,
      metadata: {
        createdAt: new Date().toISOString(),
        commits: params.commits.map(c => c.hash),
        versions: params.commits.length
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
  async save(
    document: FinalDocument,
    docsRoot: string,
    options: { versionDocs?: boolean } = {}
  ): Promise<string> {
    const safeBranch = this.sanitizeBranchName(document.branch);
    const branchDir = path.join(docsRoot, safeBranch);
    await fs.mkdir(branchDir, { recursive: true });

    const versionDocs = options.versionDocs !== false;
    const filename = versionDocs
      ? `${await DocumentGenerator.getNextVersionFilename(branchDir)}`
      : `${safeBranch}-${new Date().toISOString().split('T')[0]}.md`;

    const filePath = path.join(branchDir, filename);
    await fs.writeFile(filePath, document.content, 'utf-8');
    return filePath;
  }

  private static async getNextVersionFilename(branchDir: string): Promise<string> {
    let files: string[] = [];
    try {
      files = await fs.readdir(branchDir);
    } catch {
      // ignore
    }

    const versions = files
      .filter(f => /^\d+\.\d+\.md$/.test(f))
      .map(f => f.replace('.md', ''))
      .map(v => {
        const [major, minor] = v.split('.').map(Number);
        return { major, minor };
      })
      .filter(v => Number.isFinite(v.major) && Number.isFinite(v.minor))
      .sort((a, b) => (a.major - b.major) || (a.minor - b.minor));

    if (versions.length === 0) return '1.0.md';
    const last = versions[versions.length - 1];
    return `${last.major}.${last.minor + 1}.md`;
  }

  private generateTitleFromCommits(
    branch: string,
    commits: Array<{ hash: string; message: string }>
  ): string {
    if (commits.length === 0) return `Change on ${branch}`;
    if (commits.length === 1) return this.stripConventionalPrefix(commits[0].message);
    return `${this.stripConventionalPrefix(commits[0].message)} (+${commits.length - 1} more)`;
  }

  private stripConventionalPrefix(message: string): string {
    return message.replace(/^\w+(\([^)]*\))?:\s*/, '').trim() || message.trim();
  }

  private assembleMarkdown(params: {
    title: string;
    branch: string;
    commits: Array<{ hash: string; message: string }>;
    files: string[];
    qa: QAPair[];
    language: 'en' | 'pt-BR' | 'es';
  }): string {
    const locale = params.language;
    const now = new Date();
    const date = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now);

    const diagrams: string[] = [];
    const codeBlocks: string[] = [];
    const tables: string[] = [];
    const urls = new Set<string>();

    const qaRendered = params.qa.map((pair, idx) => {
      const parsed = parseRichResponse(pair.answer);
      parsed.mermaidBlocks.forEach(b => diagrams.push(b));
      parsed.codeBlocks.forEach(b => {
        const lang = b.language ? b.language : '';
        codeBlocks.push(`\`\`\`${lang}\n${b.code}\n\`\`\``);
      });
      parsed.tables.forEach(t => tables.push(t));
      parsed.urls.forEach(u => urls.add(u));

      const answerText = parsed.plainText.trim() ? parsed.plainText.trim() : '_No answer._';
      return `### Q${idx + 1}: ${pair.question}\n\n${answerText}`;
    }).join('\n\n');

    const lines: string[] = [];
    lines.push(`# ${params.title}`);
    lines.push('');
    lines.push(`**Branch:** ${params.branch} | **Date:** ${date} | **Commits:** ${params.commits.length}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Developer-provided diagrams first
    if (diagrams.length > 0) {
      lines.push(diagrams.join('\n\n'));
      lines.push('');
    }

    lines.push('## Q&A');
    lines.push('');
    lines.push(qaRendered || '_No Q&A captured._');
    lines.push('');

    if (codeBlocks.length > 0) {
      lines.push('## Code');
      lines.push('');
      lines.push(codeBlocks.join('\n\n'));
      lines.push('');
    }

    if (tables.length > 0) {
      lines.push('## Tables');
      lines.push('');
      lines.push(tables.join('\n\n'));
      lines.push('');
    }

    if (urls.size > 0) {
      lines.push('## References');
      lines.push('');
      Array.from(urls).forEach(u => lines.push(`- ${u}`));
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push(`*Brain dump captured on ${date}, ${time}*`);
    lines.push('');
    return lines.join('\n');
  }

  private assembleMarkdownFromParts(params: {
    title: string;
    branch: string;
    commits: Array<{ hash: string; message: string }>;
    files: string[];
    qa: QAPair[];
    language: 'en' | 'pt-BR' | 'es';
    mainContentMarkdown: string;
    aiDiagram: string | null;
    aiTable: string | null;
    plan: DocumentPlan;
  }): string {
    const locale = params.language;
    const now = new Date();
    const date = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now);

    const developerDiagrams: string[] = [];
    const codeBlocks: string[] = [];
    const developerTables: string[] = [];
    const urls = new Set<string>();

    // Parse developer answers for rich content
    params.qa.forEach(pair => {
      const parsed = parseRichResponse(pair.answer);
      parsed.mermaidBlocks.forEach(b => developerDiagrams.push(b));
      parsed.codeBlocks.forEach(b => {
        const lang = b.language ? b.language : '';
        codeBlocks.push('```' + lang + '\n' + b.code + '\n```');
      });
      parsed.tables.forEach(t => developerTables.push(t));
      parsed.urls.forEach(u => urls.add(u));
    });

    const lines: string[] = [];
    
    // Header
    lines.push(`# 🧠 ${params.title}`);
    lines.push('');
    lines.push(`> **Brain Dump** | Branch: \`${params.branch}\` | ${date} ${time} | ${params.commits.length} commit(s)`);
    lines.push('');

    // Technical Intent
    if (params.plan.intent && params.plan.intent !== 'unknown') {
      const intentLabel = params.plan.intent.toUpperCase();
      lines.push(`**Type:** \`${intentLabel}\` ${params.plan.intentRationale ? `— ${params.plan.intentRationale}` : ''}`);
      lines.push('');
    }
    
    // Commits summary
    if (params.commits.length > 0) {
      lines.push('<details>');
      lines.push('<summary>📝 Commits included</summary>');
      lines.push('');
      params.commits.forEach(c => {
        lines.push(`- \`${c.hash.substring(0, 7)}\` ${c.message}`);
      });
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }

    // Files changed
    if (params.files.length > 0) {
      lines.push('<details>');
      lines.push(`<summary>📁 Files changed (${params.files.length})</summary>`);
      lines.push('');
      params.files.slice(0, 30).forEach(f => {
        lines.push(`- \`${f}\``);
      });
      if (params.files.length > 30) {
        lines.push(`- ... and ${params.files.length - 30} more`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }

    lines.push('---');
    lines.push('');

    // AI Diagram (if generated)
    if (params.aiDiagram) {
      lines.push('## 📊 Architecture / Flow');
      lines.push('');
      lines.push(params.aiDiagram);
      lines.push('');
    }

    // Developer-provided diagrams
    if (developerDiagrams.length > 0) {
      if (!params.aiDiagram) {
        lines.push('## 📊 Diagrams');
        lines.push('');
      }
      lines.push(developerDiagrams.join('\n\n'));
      lines.push('');
    }

    // Main AI-synthesized content
    const main = String(params.mainContentMarkdown ?? '').trim();
    if (main) {
      lines.push(main);
      lines.push('');
    }

    // Predicted Impact (Deep Context)
    if (params.plan.impactedFiles && params.plan.impactedFiles.length > 0) {
      lines.push('## 🔗 Deep Context (Predicted Impact)');
      lines.push('');
      params.plan.impactedFiles.forEach(f => {
        lines.push(`- **${f.file}**: ${f.reason}`);
      });
      lines.push('');
    }

    // AI Table (if generated)
    if (params.aiTable) {
      lines.push('## 📋 Summary Table');
      lines.push('');
      lines.push(params.aiTable);
      lines.push('');
    }

    // Developer tables
    if (developerTables.length > 0) {
      if (!params.aiTable) {
        lines.push('## 📋 Tables');
        lines.push('');
      }
      lines.push(developerTables.join('\n\n'));
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    
    // Raw Q&A section (collapsed by default for cleaner look)
    lines.push('<details>');
    lines.push('<summary>💬 Raw Q&A Session</summary>');
    lines.push('');
    params.qa.forEach((pair, idx) => {
      const parsed = parseRichResponse(pair.answer);
      const answerText = parsed.plainText.trim() ? parsed.plainText.trim() : '_No answer._';
      lines.push(`**Q${idx + 1}:** ${pair.question}`);
      lines.push('');
      lines.push(`> ${answerText.split('\n').join('\n> ')}`);
      lines.push('');
    });
    lines.push('</details>');
    lines.push('');

    // Code blocks from answers
    if (codeBlocks.length > 0) {
      lines.push('<details>');
      lines.push('<summary>💻 Code Snippets</summary>');
      lines.push('');
      lines.push(codeBlocks.join('\n\n'));
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }

    // References
    if (urls.size > 0) {
      lines.push('## 🔗 References');
      lines.push('');
      Array.from(urls).forEach(u => lines.push(`- ${u}`));
      lines.push('');
    }

    // AI Decisions (transparency)
    lines.push('---');
    lines.push('');
    lines.push('<details>');
    lines.push('<summary>🤖 AI Decisions</summary>');
    lines.push('');
    lines.push(`- **Technical Intent:** ${params.plan.intent} (${params.plan.intentRationale})`);
    lines.push(`- **Complexity:** ${params.plan.complexity}`);
    lines.push(`- **Impact analysis:** ${params.plan.impactedFiles.length} file(s) identified`);
    lines.push(`- **Generated diagram:** ${params.plan.shouldGenerateDiagram ? `Yes (${params.plan.diagramType}) - ${params.plan.diagramRationale}` : 'No'}`);
    lines.push(`- **Generated table:** ${params.plan.shouldGenerateTable ? `Yes (${params.plan.tableType}) - ${params.plan.tableRationale}` : 'No'}`);
    if (params.plan.keyInsights && params.plan.keyInsights.length > 0) {
      lines.push(`- **Key insights identified:** ${params.plan.keyInsights.join('; ')}`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');

    lines.push(`*Brain dump captured on ${date}, ${time}*`);
    lines.push('');
    return lines.join('\n');
  }

  /**
   * Format document using custom template
   */
  private formatWithCustomTemplate(
    branch: string,
    versions: CommitVersion[],
    answers: BrainDumpAnswers
  ): string {
    if (!this.customTemplate) {
      return this.formatDocument(branch, versions, answers);
    }

    let content = this.customTemplate;

    const title = this.generateTitle(branch, versions);
    const createdAt = new Date().toLocaleDateString();
    const generatedAt = new Date().toLocaleString();
    const commitCount = versions.length.toString();

    // Build brain dump content
    const brainDump = this.formatBrainDump(answers);

    // Build commits summary
    const commitsSummary = this.formatCommitsSummary(versions);

    const commitsList = this.formatCommitsSummary(versions);

    // Build changes detail
    const changesDetail = this.formatChangesDetail(versions);

    const filesList = this.formatFilesList(versions);

    // Replace template variables
    content = content.replace(/{PROJECT_NAME}/g, this.projectName);
    content = content.replace(/{BRANCH_NAME}/g, branch);
    content = content.replace(/{DATE}/g, createdAt);
    content = content.replace(/{COMMITS_SUMMARY}/g, commitsSummary);
    content = content.replace(/{BRAIN_DUMP}/g, brainDump);
    content = content.replace(/{CHANGES_DETAIL}/g, changesDetail);

    // New placeholders (optional)
    content = content.replace(/{TITLE}/g, title);
    content = content.replace(/{COMMIT_COUNT}/g, commitCount);
    content = content.replace(/{CREATED_AT}/g, createdAt);
    content = content.replace(/{GENERATED_AT}/g, generatedAt);
    content = content.replace(/{COMMITS_LIST}/g, commitsList);
    content = content.replace(/{FILES_LIST}/g, filesList);

    content = content.replace(/{WHAT_AND_WHY}/g, this.formatAnswer(answers.what_and_why));
    content = content.replace(/{KEY_DECISIONS}/g, this.formatAnswer(answers.key_decisions));
    content = content.replace(/{GOTCHAS}/g, this.formatAnswer(answers.gotchas));
    content = content.replace(/{ADDITIONAL_CONTEXT}/g, this.formatAnswer(answers.additional_context));

    return content;
  }

  /**
   * Format files list for custom template
   */
  private formatFilesList(versions: CommitVersion[]): string {
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
   * Format brain dump answers for custom template
   */
  private formatBrainDump(answers: BrainDumpAnswers): string {
    const sections: string[] = [];

    if (answers.what_and_why && answers.what_and_why.trim()) {
      sections.push(`### What & Why\n\n${answers.what_and_why.trim()}`);
    }

    if (answers.key_decisions && answers.key_decisions.trim()) {
      sections.push(`### Key Decisions\n\n${answers.key_decisions.trim()}`);
    }

    if (answers.gotchas && answers.gotchas.trim()) {
      sections.push(`### Gotchas & Warnings\n\n${answers.gotchas.trim()}`);
    }

    if (answers.additional_context && answers.additional_context.trim()) {
      sections.push(`### Additional Context\n\n${answers.additional_context.trim()}`);
    }

    return sections.length > 0 ? sections.join('\n\n') : '_No brain dump provided._';
  }

  /**
   * Format commits summary for custom template
   */
  private formatCommitsSummary(versions: CommitVersion[]): string {
    if (versions.length === 0) {
      return '_No commits._';
    }

    return versions.map(v => {
      const shortHash = v.commit.substring(0, 7);
      const date = new Date(v.timestamp).toLocaleDateString();
      return `- **${shortHash}** - ${v.message} _(${date})_`;
    }).join('\n');
  }

  /**
   * Format detailed changes for custom template
   */
  private formatChangesDetail(versions: CommitVersion[]): string {
    const allFiles = new Set<string>();

    versions.forEach(v => {
      v.files.forEach(f => allFiles.add(f));
    });

    const filesList = Array.from(allFiles).sort();

    if (filesList.length === 0) {
      return '_No files modified._';
    }

    const lines = [
      `**${filesList.length} files modified:**`,
      '',
      ...filesList.map(f => `- \`${f}\``)
    ];

    return lines.join('\n');
  }

  /**
   * Format document using default template
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
  async listDocuments(docsRoot: string): Promise<string[]> {
    const docsDirNew = docsRoot;
    const docsDirOld = path.join(docsRoot, 'docs');
    const documents: string[] = [];

    try {
      // Prefer PRD layout; fall back to legacy layout if needed.
      let baseDir = docsDirNew;
      try {
        await fs.access(docsDirNew);
      } catch {
        baseDir = docsDirOld;
      }

      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) continue;
          // Look for .md files inside branch directories
          const branchDir = path.join(baseDir, entry.name);
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
    // Legacy: branch-YYYY-MM-DD.md
    const legacy = filename.match(/^(.+)-(\d{4}-\d{2}-\d{2})\.md$/);
    if (legacy) {
      return { branch: legacy[1], date: legacy[2] };
    }

    // PRD layout: <branch>/<n.n>.md (we expose version as "date" field for backwards compatibility)
    const parts = filename.split('/');
    if (parts.length === 2 && /^\d+\.\d+\.md$/.test(parts[1])) {
      return { branch: parts[0], date: parts[1].replace('.md', '') };
    }

    return null;
  }
}
