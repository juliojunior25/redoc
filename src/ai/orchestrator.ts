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
      content: `You are a senior engineer conducting a BRAIN DUMP session to capture tacit knowledge before it's lost.

Your goal: Extract the knowledge that EXISTS ONLY IN THE DEVELOPER'S HEAD - context, rationale, gotchas, and lessons that won't be obvious from reading the code later.

Generate 3-5 probing questions based on the diff. Each question should:
1. TARGET HIDDEN KNOWLEDGE: Ask about things NOT visible in the code (why this approach, what was tried first, what almost broke, what's fragile)
2. BE SPECIFIC: Reference actual files/functions from the diff
3. PREVENT KNOWLEDGE LOSS: Focus on what a future maintainer would struggle with
4. ENCOURAGE STORYTELLING: Invite the developer to explain the journey, not just the destination

Question types to include:
- DECISION: "Why X instead of Y?" / "What made you choose this approach?"
- CONTEXT: "What triggered this change?" / "What was failing/breaking?"
- GOTCHAS: "What's tricky here?" / "What would break if someone changes X?"
- FUTURE: "What should someone know before touching this?" / "What's the next step?"
- LESSONS: "What did you learn?" / "What would you do differently?"

DO NOT ask:
- Things obvious from reading the code
- Generic questions like "Can you explain this change?"
- Yes/no questions

Output language: ${languageLabel(lang)}.

Return ONLY JSON: { "questions": ["...", "..."] }`
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
  const count = isSmall ? 3 : 4;

  const bank: Record<typeof lang, string[]> = {
    en: [
      'What was the trigger for this change? What problem were you actually solving?',
      'What approaches did you try or consider before landing on this solution?',
      'What\'s the trickiest part of this code that someone might break without realizing?',
      'If you had more time, what would you improve or do differently here?'
    ],
    'pt-BR': [
      'O que motivou essa mudança? Qual problema você estava realmente resolvendo?',
      'Quais abordagens você tentou ou considerou antes de chegar nessa solução?',
      'Qual a parte mais traiçoeira desse código que alguém pode quebrar sem perceber?',
      'Se tivesse mais tempo, o que você melhoraria ou faria diferente aqui?'
    ],
    es: [
      '¿Qué motivó este cambio? ¿Qué problema estabas resolviendo realmente?',
      '¿Qué enfoques probaste o consideraste antes de llegar a esta solución?',
      '¿Cuál es la parte más delicada de este código que alguien podría romper sin darse cuenta?',
      'Si tuvieras más tiempo, ¿qué mejorarías o harías diferente aquí?'
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
      content: `You are synthesizing a BRAIN DUMP into useful documentation for future maintainers.

Your input: The developer's raw answers to probing questions about their change.

Your output: A structured summary that PRESERVES THE DEVELOPER'S INSIGHTS while making them scannable.

Rules:
1. PRESERVE VOICE: Use the developer's own words and phrasing when they're clear
2. DON'T INVENT: Never add information not in the answers
3. HIGHLIGHT GOTCHAS: Surface warnings, edge cases, and "watch out for" items prominently
4. CAPTURE DECISIONS: Clearly document what was chosen AND what was rejected (and why)
5. MAKE ACTIONABLE: A future dev should know what to do (or not do) after reading this

Structure to use:
## TL;DR
One paragraph max. The core insight a future maintainer needs.

## The Context
What triggered this? What was the problem?

## The Approach
What was done and WHY this approach over alternatives.

## Watch Out
Gotchas, edge cases, fragile areas, things that could break.

## Future Notes
(Only if relevant) Next steps, tech debt acknowledged, what would be improved with more time.

Output language: ${languageLabel(lang)}.

Return Markdown ONLY. Omit sections that have no relevant content from the answers.`
    },
    {
      role: 'user',
      content: `Context:\n- Branch: ${params.ctx.branch}\n- Commits:\n${safe(params.config, params.ctx.commits.map(c => `${c.hash.substring(0, 7)} - ${c.message}`).join('\n'))}\n- Files: ${safe(params.config, params.ctx.files.join(', '))}\n\nDeveloper Brain Dump:\n${safe(params.config, params.qa.map((p, i) => `Q${i + 1}: ${p.question}\nA: ${p.answer}`).join('\n\n'))}\n\nSynthesize this into structured documentation.`
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
