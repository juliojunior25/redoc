import * as path from 'path';

export interface TrivialCheckInput {
  commitMessage: string;
  files: string[];
  diff: string;
}

export interface TrivialCheckResult {
  isTrivial: boolean;
  reason?: string;
}

const DOC_EXTENSIONS = new Set(['.md', '.txt', '.rst']);
const IMPORTANT_FILES = new Set([
  'package.json',
  'cargo.toml',
  'cargo.lock',
  'go.mod',
  'go.sum',
  'pyproject.toml',
  'requirements.txt',
  'composer.json',
  'composer.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'gradle.properties',
  'deno.json',
  'deno.jsonc'
]);

function isDocFile(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  if (IMPORTANT_FILES.has(base)) return false;
  const ext = path.extname(base);
  return DOC_EXTENSIONS.has(ext) || base === 'readme' || base === 'readme.md';
}

function countChangedLines(diff: string): number {
  const lines = diff.split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('@@')) continue;
    if (line.startsWith('+') || line.startsWith('-')) {
      count++;
    }
  }
  return count;
}

function isWhitespaceOnlyDiff(diff: string): boolean {
  const lines = diff.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
    if (line.startsWith('+') || line.startsWith('-')) {
      const content = line.slice(1);
      if (content.trim().length > 0) {
        return false;
      }
    }
  }
  return true;
}

export function detectTrivialChange(inputs: TrivialCheckInput[]): TrivialCheckResult {
  if (inputs.length === 0) return { isTrivial: true, reason: 'No commits/changes detected' };

  const allFiles = new Set<string>();
  inputs.forEach(i => i.files.forEach(f => allFiles.add(f)));

  // Conservative: if any important file touched, it's not trivial.
  for (const file of allFiles) {
    const base = path.basename(file).toLowerCase();
    if (IMPORTANT_FILES.has(base)) {
      return { isTrivial: false };
    }
  }

  const filesList = Array.from(allFiles);

  // Only docs changed
  if (filesList.length > 0 && filesList.every(isDocFile)) {
    // README-only special-case
    if (filesList.length === 1 && path.basename(filesList[0]).toLowerCase().startsWith('readme')) {
      return { isTrivial: true, reason: 'Only README changed' };
    }
    return { isTrivial: true, reason: 'Only documentation files changed' };
  }

  // chore: + very small diff
  const allChore = inputs.every(i => i.commitMessage.trim().toLowerCase().startsWith('chore:'));
  const totalChangedLines = inputs.reduce((sum, i) => sum + countChangedLines(i.diff), 0);
  if (allChore && totalChangedLines > 0 && totalChangedLines < 20) {
    return { isTrivial: true, reason: 'Small chore change' };
  }

  // whitespace-only
  const whitespaceOnly = inputs.every(i => isWhitespaceOnlyDiff(i.diff));
  if (whitespaceOnly) {
    return { isTrivial: true, reason: 'Whitespace/formatting-only changes' };
  }

  return { isTrivial: false };
}
