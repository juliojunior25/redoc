import { sanitizeForAI } from '../utils/sanitize.js';
import { RedocConfig } from '../types.js';
import { AIChatMessage, ChangeContext, DocumentPlan, ProviderId } from './types.js';
import { tryProviders } from './fallback.js';

function languageLabel(lang: string): string {
  if (lang === 'pt-BR') return 'Portuguese (Brazil)';
  if (lang === 'es') return 'Spanish';
  return 'English';
}

function truncateDiff(diff: string): string {
  const maxChars = 8000;
  if (diff.length <= maxChars) return diff;
  return diff.slice(0, maxChars) + '\n... (truncated)';
}

function safe(config: RedocConfig, text: string): string {
  if (config.redactSecrets === false) return text;
  return sanitizeForAI(text).text;
}

export async function generateQuestions(params: {
  config: RedocConfig;
  ctx: ChangeContext;
  preferredProvider?: ProviderId;
}): Promise<{ questions: string[]; provider: ProviderId | 'offline' }> {
  const lang = params.config.language || 'en';

  const commits = params.ctx.commits.map(c => `${c.hash.substring(0, 7)} - ${c.message}`);
  const files = params.ctx.files.join(', ');
  const diffPreview = truncateDiff(params.ctx.diff);

  const messages: AIChatMessage[] = [
    {
      role: 'system',
      content: `You are helping document a code change. Generate 2-4 questions to understand the developer's reasoning.\n\nRules:\n- Ask about WHY, not WHAT (code shows what).\n- Be specific to THIS change (use filenames/functions from the diff).\n- 2 questions for small changes, 3-4 for larger changes.\n- Questions answerable in 1-3 sentences.\n- Output language: ${languageLabel(lang)}.\n\nReturn ONLY JSON: { "questions": ["...", "..."] }`
    },
    {
      role: 'user',
      content: `## The Change\nBranch: ${params.ctx.branch}\nCommits:\n${safe(params.config, commits.join('\n'))}\n\nFiles changed: ${safe(params.config, files)}\n\nDiff preview:\n\n\`\`\`diff\n${safe(params.config, diffPreview)}\n\`\`\``
    }
  ];

  const result = await tryProviders({
    config: params.config,
    preferred: params.preferredProvider || params.config.aiProvider || 'groq',
    run: async (provider) => provider.chatJson<{ questions: string[] }>({ config: params.config, messages })
  });

  if (!result.value?.questions || result.value.questions.length < 2) {
    return { questions: offlineQuestions(params.ctx.diff, lang), provider: 'offline' };
  }

  const normalized = result.value.questions
    .map(q => String(q ?? '').trim())
    .filter(Boolean)
    .map(q => q.replace(/^\d+\s*[\).:-]\s*/, ''))
    .slice(0, 4);

  if (normalized.length < 2) {
    return { questions: offlineQuestions(params.ctx.diff, lang), provider: 'offline' };
  }

  return { questions: normalized, provider: (result.provider as ProviderId) ?? 'offline' };
}

function offlineQuestions(diff: string, lang: 'en' | 'pt-BR' | 'es'): string[] {
  const isSmall = diff.split(/\r?\n/).filter(l => l.startsWith('+') || l.startsWith('-')).length < 80;
  const count = isSmall ? 2 : 3;

  const bank: Record<typeof lang, string[]> = {
    en: [
      'What problem does this change solve, and why now?',
      'What alternatives did you consider, and why did you choose this approach?',
      'What edge cases or risks should a future maintainer watch for?'
    ],
    'pt-BR': [
      'Qual problema essa mudança resolve, e por que agora?',
      'Quais alternativas você considerou, e por que escolheu essa abordagem?',
      'Quais edge cases/risco um futuro mantenedor precisa ficar atento?'
    ],
    es: [
      '¿Qué problema resuelve este cambio, y por qué ahora?',
      '¿Qué alternativas consideraste y por qué elegiste este enfoque?',
      '¿Qué casos límite o riesgos debería vigilar alguien en el futuro?'
    ]
  };

  return bank[lang].slice(0, count);
}

export async function planDocument(params: {
  config: RedocConfig;
  ctx: ChangeContext;
  qa: Array<{ question: string; answer: string }>;
  hasDeveloperDiagrams: boolean;
  hasDeveloperTables: boolean;
  preferredProvider?: ProviderId;
}): Promise<{ plan: DocumentPlan; provider: ProviderId | 'offline' }> {
  const lang = params.config.language || 'en';

  const messages: AIChatMessage[] = [
    {
      role: 'system',
      content: `You are analyzing a code change to decide how to document it. Your goal: create USEFUL documentation, not bloated documentation.\n\nOutput language: ${languageLabel(lang)}.\n\nReturn ONLY JSON matching this schema:\n{\n  "shouldGenerateDiagram": boolean,\n  "diagramRationale": string | null,\n  "diagramType": "sequence"|"flowchart"|"er"|"state"|"architecture"|null,\n  "diagramFocus": string | null,\n  \n  "shouldGenerateTable": boolean,\n  "tableRationale": string | null,\n  "tableType": "comparison"|"tradeoffs"|"steps"|null,\n  \n  "sections": string[],\n  "complexity": "minimal"|"standard"|"detailed",\n  \n  "skipGeneration": boolean,\n  "skipReason": string | null\n}`
    },
    {
      role: 'user',
      content: `## The Change\nBranch: ${params.ctx.branch}\nCommits:\n${safe(params.config, params.ctx.commits.map(c => `${c.hash.substring(0, 7)} - ${c.message}`).join('\n'))}\n\nFiles changed: ${safe(params.config, params.ctx.files.join(', '))}\n\n## Developer's Answers\n${safe(params.config, params.qa.map((p, i) => `Q${i + 1}: ${p.question}\nA: ${p.answer}`).join('\n\n'))}\n\n## What Developer Already Provided\n- Diagrams: ${params.hasDeveloperDiagrams ? 'yes' : 'no'}\n- Tables: ${params.hasDeveloperTables ? 'yes' : 'no'}\n\n## Rules\n- If developer provided diagram, set shouldGenerateDiagram=false.\n- If developer provided table, set shouldGenerateTable=false.\n- Be conservative; only suggest visuals if they genuinely clarify.\n- If trivial, set skipGeneration=true with a clear reason.\n`
    }
  ];

  const result = await tryProviders({
    config: params.config,
    preferred: params.preferredProvider || params.config.generation?.providers?.analysis || params.config.aiProvider || 'groq',
    run: async (provider) => provider.chatJson<DocumentPlan>({ config: params.config, messages })
  });

  if (!result.value) {
    return {
      plan: offlinePlan(params.hasDeveloperDiagrams, params.hasDeveloperTables),
      provider: 'offline'
    };
  }

  // Enforce non-duplication rule
  const plan = { ...result.value };
  if (params.hasDeveloperDiagrams) plan.shouldGenerateDiagram = false;
  if (params.hasDeveloperTables) plan.shouldGenerateTable = false;

  // Sanity defaults
  if (!Array.isArray(plan.sections) || plan.sections.length === 0) {
    plan.sections = ['Summary', 'How It Works'];
  }
  if (!plan.complexity) plan.complexity = 'standard';
  if (plan.skipGeneration === undefined) plan.skipGeneration = false;
  if (plan.shouldGenerateDiagram === undefined) plan.shouldGenerateDiagram = false;
  if (plan.shouldGenerateTable === undefined) plan.shouldGenerateTable = false;

  return { plan, provider: (result.provider as ProviderId) ?? 'offline' };
}

function offlinePlan(hasDiagram: boolean, hasTable: boolean): DocumentPlan {
  return {
    shouldGenerateDiagram: false,
    diagramRationale: null,
    diagramType: null,
    diagramFocus: null,
    shouldGenerateTable: false,
    tableRationale: null,
    tableType: null,
    sections: ['Summary', 'Notes'],
    complexity: 'minimal',
    skipGeneration: false,
    skipReason: null
  };
}

export async function generateMainContent(params: {
  config: RedocConfig;
  ctx: ChangeContext;
  qa: Array<{ question: string; answer: string }>;
  plan: DocumentPlan;
  preferredProvider?: ProviderId;
}): Promise<{ markdown: string; provider: ProviderId | 'offline' }> {
  const lang = params.config.language || 'en';

  const messages: AIChatMessage[] = [
    {
      role: 'system',
      content: `Write concise documentation for this code change.\n\nRules:\n- Be concise.\n- Use developer's words when possible.\n- Don't invent information.\n- Output language: ${languageLabel(lang)}.\n\nReturn Markdown ONLY.`
    },
    {
      role: 'user',
      content: `Context:\n- Branch: ${params.ctx.branch}\n- Commits:\n${safe(params.config, params.ctx.commits.map(c => `${c.hash.substring(0, 7)} - ${c.message}`).join('\n'))}\n\nDeveloper Q&A:\n${safe(params.config, params.qa.map((p, i) => `Q${i + 1}: ${p.question}\nA: ${p.answer}`).join('\n\n'))}\n\nSections to write: ${params.plan.sections.join(', ')}\nComplexity: ${params.plan.complexity}\n\nWrite the sections in this exact order, each as a level-2 heading (##).`
    }
  ];

  const result = await tryProviders({
    config: params.config,
    preferred: params.preferredProvider || params.config.generation?.providers?.content || params.config.aiProvider || 'groq',
    run: async (provider) => provider.chatText({ config: params.config, messages, temperature: 0.6, maxTokens: 2500 })
  });

  if (!result.value) {
    // Offline fallback: just render Q&A as notes
    const notes = params.qa.length
      ? params.qa.map((p, i) => `- **Q${i + 1}:** ${p.question}\n  - ${p.answer.trim() || '_No answer._'}`).join('\n')
      : '_No Q&A captured._';

    return { markdown: `## Summary\n\n_Offline mode._\n\n## Notes\n\n${notes}\n`, provider: 'offline' };
  }

  return { markdown: String(result.value).trim(), provider: (result.provider as ProviderId) ?? 'offline' };
}

export async function generateDiagram(params: {
  config: RedocConfig;
  qa: Array<{ question: string; answer: string }>;
  plan: DocumentPlan;
  preferredProvider?: ProviderId;
}): Promise<{ mermaid: string | null; provider: ProviderId | 'offline' }> {
  if (!params.plan.shouldGenerateDiagram || !params.plan.diagramType) {
    return { mermaid: null, provider: 'offline' };
  }

  const lang = params.config.language || 'en';

  const messages: AIChatMessage[] = [
    {
      role: 'system',
      content: `Generate a ${params.plan.diagramType} Mermaid diagram.\n\nWHY needed: ${params.plan.diagramRationale || ''}\nWHAT to illustrate: ${params.plan.diagramFocus || ''}\n\nRules:\n- Keep simple: 4-6 elements max.\n- Only essential elements.\n- Return ONLY a Mermaid fenced code block.\n- Output language: ${languageLabel(lang)}.`
    },
    {
      role: 'user',
      content: `Context (developer Q&A):\n${safe(params.config, params.qa.map((p, i) => `Q${i + 1}: ${p.question}\nA: ${p.answer}`).join('\n\n'))}`
    }
  ];

  const result = await tryProviders({
    config: params.config,
    preferred: params.preferredProvider || params.config.generation?.providers?.diagrams || params.config.aiProvider || 'groq',
    run: async (provider) => provider.chatText({ config: params.config, messages, temperature: 0.3, maxTokens: 1200 })
  });

  if (!result.value) return { mermaid: null, provider: 'offline' };

  const text = String(result.value).trim();
  const start = text.indexOf('```mermaid');
  const end = text.lastIndexOf('```');
  if (start !== -1 && end !== -1 && end > start) {
    return { mermaid: text.slice(start, end + 3), provider: (result.provider as ProviderId) ?? 'offline' };
  }

  // If not fenced, fence it.
  return { mermaid: `\`\`\`mermaid\n${text}\n\`\`\``, provider: (result.provider as ProviderId) ?? 'offline' };
}

export async function generateTable(params: {
  config: RedocConfig;
  qa: Array<{ question: string; answer: string }>;
  plan: DocumentPlan;
  preferredProvider?: ProviderId;
}): Promise<{ table: string | null; provider: ProviderId | 'offline' }> {
  if (!params.plan.shouldGenerateTable || !params.plan.tableType) {
    return { table: null, provider: 'offline' };
  }

  const lang = params.config.language || 'en';

  const messages: AIChatMessage[] = [
    {
      role: 'system',
      content: `Generate ONE Markdown table of type "${params.plan.tableType}" to clarify the change.\n\nWHY needed: ${params.plan.tableRationale || ''}\n\nRules:\n- Keep small (max ~6 rows).\n- Return ONLY the Markdown table (no extra text).\n- Output language: ${languageLabel(lang)}.`
    },
    {
      role: 'user',
      content: `Context (developer Q&A):\n${safe(params.config, params.qa.map((p, i) => `Q${i + 1}: ${p.question}\nA: ${p.answer}`).join('\n\n'))}`
    }
  ];

  const result = await tryProviders({
    config: params.config,
    preferred: params.preferredProvider || params.config.generation?.providers?.content || params.config.aiProvider || 'groq',
    run: async (provider) => provider.chatText({ config: params.config, messages, temperature: 0.2, maxTokens: 900 })
  });

  if (!result.value) return { table: null, provider: 'offline' };

  const table = String(result.value).trim();
  if (!table.includes('|') || !table.includes('\n')) {
    return { table: null, provider: 'offline' };
  }

  return { table, provider: (result.provider as ProviderId) ?? 'offline' };
}
