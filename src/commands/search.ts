import chalk from 'chalk';
import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import { ConfigManager } from '../utils/config.js';

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: Array<Dirent>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else {
      yield fullPath;
    }
  }
}

export async function searchCommand(query?: string): Promise<void> {
  const configManager = new ConfigManager();
  const config = await configManager.load();
  const docsPath = configManager.resolveDocsPath(config);

  if (!query || !query.trim()) {
    console.log(chalk.red('Error: missing search query.'));
    console.log(chalk.gray('Usage: redoc search <query>'));
    process.exit(1);
  }

  const needle = query.trim().toLowerCase();
  let matches = 0;

  console.log(chalk.blue.bold('\n🔎 ReDoc Search\n'));
  console.log(chalk.gray(`Docs path: ${docsPath}`));
  console.log(chalk.gray(`Query: ${query}\n`));

  for await (const filePath of walk(docsPath)) {
    if (!filePath.endsWith('.md')) continue;

    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.toLowerCase().includes(needle)) {
        matches++;
        const rel = path.relative(process.cwd(), filePath);
        console.log(chalk.green(`${rel}:${i + 1}`));
        console.log(chalk.gray(`  ${line.trim()}`));
      }
    }
  }

  if (matches === 0) {
    console.log(chalk.yellow('No matches found.'));
  } else {
    console.log(chalk.blue(`\n${matches} match(es).`));
  }
}
