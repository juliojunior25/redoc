export interface SanitizationResult {
  text: string;
  redactions: number;
}

export interface SanitizationOptions {
  enabled?: boolean;
}

const REDACTION = '[REDACTED]';

function applyRedaction(input: string, pattern: RegExp, replacement: string | ((...args: string[]) => string)): { output: string; count: number } {
  let count = 0;
  const output = input.replace(pattern, (...args: any[]) => {
    count += 1;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });

  return { output, count };
}

/**
 * Best-effort redaction of common secret/token formats.
 * Intentionally conservative: avoids broad "key=value" wipes.
 */
export function sanitizeForAI(text: string, options: SanitizationOptions = {}): SanitizationResult {
  if (!text) return { text: '', redactions: 0 };
  if (options.enabled === false) return { text, redactions: 0 };

  let current = text;
  let redactions = 0;

  const patterns: Array<{ pattern: RegExp; replacement: string | ((...args: string[]) => string) }> = [
    // Private keys (PEM blocks)
    { pattern: /-----BEGIN ([A-Z ]*?)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g, replacement: (m) => m.split('\n')[0] + `\n${REDACTION}\n` + m.split('\n').slice(-1)[0] },

    // GitHub tokens (classic + fine-grained)
    { pattern: /\bghp_[A-Za-z0-9]{30,}\b/g, replacement: REDACTION },
    { pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, replacement: REDACTION },

    // Groq keys (gsk_...)
    { pattern: /\bgsk_[A-Za-z0-9]{20,}\b/g, replacement: REDACTION },

    // OpenAI keys
    { pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, replacement: REDACTION },

    // Slack tokens
    { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: REDACTION },

    // AWS Access Key IDs
    { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: REDACTION },

    // JWTs (very common in diffs/logs)
    { pattern: /\beyJ[A-Za-z0-9_\-]+=*\.[A-Za-z0-9_\-]+=*\.[A-Za-z0-9_\-]+=*\b/g, replacement: REDACTION },

    // Bearer tokens in headers/logs
    { pattern: /(Authorization:\s*Bearer\s+)([^\s'"\n]+)/gi, replacement: (_m: string) => `Authorization: Bearer ${REDACTION}` },
    { pattern: /(Bearer\s+)([^\s'"\n]+)/gi, replacement: (_m: string) => `Bearer ${REDACTION}` },

    // Common env var assignments (only for known secret-like names)
    { pattern: /\b([A-Z0-9_]*?(?:API|ACCESS|SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*?)\s*=\s*(['"]?)([^'"\n]+)\2/g, replacement: (_m: string, name: string, quote: string) => `${name}=${quote}${REDACTION}${quote}` },
  ];

  for (const { pattern, replacement } of patterns) {
    const { output, count } = applyRedaction(current, pattern, replacement);
    current = output;
    redactions += count;
  }

  return { text: current, redactions };
}
