export interface CodeBlock {
  language: string | null;
  code: string;
}

export interface ParsedRichResponse {
  plainText: string;
  mermaidBlocks: string[];
  codeBlocks: CodeBlock[];
  tables: string[];
  urls: string[];
}

const FENCED_BLOCK_RE = /```(\w+)?\n([\s\S]*?)```/g;
const URL_RE = /https?:\/\/[^\s)\]]+/g;

function extractTables(markdown: string): { tables: string[]; rest: string } {
  // Simple markdown table detection (pipe tables).
  const lines = markdown.split(/\r?\n/);
  const tables: string[] = [];
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1];

    const looksLikeHeader = line?.includes('|') && line.trim().startsWith('|') && line.trim().endsWith('|');
    const looksLikeSeparator = next?.trim().startsWith('|') && /\|\s*[:\- ]+\s*\|/.test(next);

    if (looksLikeHeader && looksLikeSeparator) {
      const tableLines: string[] = [line, next];
      i += 2;
      while (i < lines.length) {
        const row = lines[i];
        if (row.trim().startsWith('|') && row.trim().endsWith('|')) {
          tableLines.push(row);
          i++;
        } else {
          break;
        }
      }
      tables.push(tableLines.join('\n'));
      continue;
    }

    out.push(line);
    i++;
  }

  return { tables, rest: out.join('\n') };
}

export function parseRichResponse(markdown: string): ParsedRichResponse {
  const input = String(markdown ?? '');

  const urls = Array.from(new Set((input.match(URL_RE) || []).map(u => u.trim())));

  const mermaidBlocks: string[] = [];
  const codeBlocks: CodeBlock[] = [];

  let withoutFences = input.replace(FENCED_BLOCK_RE, (_match, langRaw, body) => {
    const language = langRaw ? String(langRaw).trim() : null;
    const code = String(body ?? '').replace(/\n$/, '');

    if (language?.toLowerCase() === 'mermaid') {
      mermaidBlocks.push('```mermaid\n' + code + '\n```');
    } else {
      codeBlocks.push({ language, code });
    }

    return '';
  });

  const { tables, rest } = extractTables(withoutFences);

  const plainText = rest
    .replace(URL_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    plainText,
    mermaidBlocks,
    codeBlocks,
    tables,
    urls
  };
}
