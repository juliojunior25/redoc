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
  const diffPreview = truncateDiff(params.ctx.diff);

  const messages: AIChatMessage[] = [
    {
      role: 'system',
      content: `You are a documentation architect analyzing a code change to decide THE BEST way to document it and understand its impact.

Your job:
1. IDENTIFY INTENT: Categorize the change (feat, fix, refactor, chore, docs, perf, test, style).
2. DEEP CONTEXT: Predict which other files in the project might be impacted by this change, even if they aren't in the diff (e.g., if a shared type changed, who uses it?).
3. VISUAL AIDS: Decide what diagrams or tables would GENUINELY help future maintainers.

## Intent Guidelines:
- feat: New feature or functionality
- fix: Bug fix
- refactor: Code change that neither fixes a bug nor adds a feature
- chore: Maintenance, dependency updates, configuration
- perf: Performance improvement
- test: Adding or correcting tests
- docs: Documentation changes only

## Deep Context Guidelines:
- Look at the files in the diff.
- If a core utility, type, or API changed, think about the downstream effects.
- Provide a reason for each impacted file.

## When to generate a DIAGRAM:
- New API endpoints or routes → flowchart showing the request flow
- State management changes → state diagram
- New integrations/services → architecture diagram showing components
- Complex conditionals or branching logic → flowchart
- Database schema changes → ER diagram
- Async flows, webhooks, queues → sequence diagram
- Hook/lifecycle changes → sequence or flowchart

## When to generate a TABLE:
- Configuration options added → comparison table of options
- Multiple approaches considered → tradeoffs table
- Step-by-step process → steps table
- Before/after comparison → comparison table
- Feature flags or toggles → options table

Output language: ${languageLabel(lang)}.

Return ONLY valid JSON:
{
  "intent": "feat"|"fix"|"refactor"|"chore"|"docs"|"perf"|"test"|"style"|"unknown",
  "intentRationale": "Brief explanation of why this intent was chosen",
  
  "impactedFiles": [
    { "file": "path/to/file.ts", "reason": "Why this file is likely impacted" }
  ],

  "shouldGenerateDiagram": boolean,
  "diagramRationale": "Why this diagram helps (or null)",
  "diagramType": "sequence"|"flowchart"|"er"|"state"|"architecture"|null,
  "diagramFocus": "What specifically to diagram (be precise)",
  
  "shouldGenerateTable": boolean,
  "tableRationale": "Why this table helps (or null)",
  "tableType": "comparison"|"tradeoffs"|"steps"|"options"|null,
  "tableFocus": "What specifically to tabulate",
  
  "keyInsights": ["insight1", "insight2"],
  "complexity": "minimal"|"standard"|"detailed",
  
  "skipGeneration": false,
  "skipReason": null
}`
    },
    {
      role: 'user',
      content: `## The Change
Branch: ${params.ctx.branch}
Commits:\n${safe(params.config, params.ctx.commits.map(c => `${c.hash.substring(0, 7)} - ${c.message}`).join('\n'))}

Files changed (${params.ctx.files.length}): ${safe(params.config, params.ctx.files.join(', '))}

## Diff Preview
\`\`\`diff
${safe(params.config, diffPreview)}
\`\`\`

## Developer's Brain Dump
${safe(params.config, params.qa.map((p, i) => `Q${i + 1}: ${p.question}\nA: ${p.answer}`).join('\n\n'))}

## Already Provided by Developer
- Diagrams: ${params.hasDeveloperDiagrams ? 'YES (skip diagram generation)' : 'NO'}
- Tables: ${params.hasDeveloperTables ? 'YES (skip table generation)' : 'NO'}

Analyze this change, identify its intent, predict impact, and decide the documentation strategy.`
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
  if (!plan.intent) plan.intent = 'unknown';
  if (!plan.intentRationale) plan.intentRationale = '';
  if (!Array.isArray(plan.impactedFiles)) plan.impactedFiles = [];
  if (!plan.complexity) plan.complexity = 'standard';
  if (plan.skipGeneration === undefined) plan.skipGeneration = false;
  if (plan.shouldGenerateDiagram === undefined) plan.shouldGenerateDiagram = false;
  if (plan.shouldGenerateTable === undefined) plan.shouldGenerateTable = false;
  if (!Array.isArray(plan.keyInsights)) plan.keyInsights = [];

  return { plan, provider: (result.provider as ProviderId) ?? 'offline' };
}

function offlinePlan(hasDiagram: boolean, hasTable: boolean): DocumentPlan {
  return {
    intent: 'unknown',
    intentRationale: 'Analysis unavailable offline',
    impactedFiles: [],
    shouldGenerateDiagram: false,
    diagramRationale: null,
    diagramType: null,
    diagramFocus: null,
    shouldGenerateTable: false,
    tableRationale: null,
    tableType: null,
    tableFocus: null,
    keyInsights: [],
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
  const diffPreview = truncateDiff(params.ctx.diff);

  const messages: AIChatMessage[] = [
    {
      role: 'system',
      content: `You are creating a BRAIN DUMP document that captures the developer's tacit knowledge about this change.

CRITICAL RULES:
1. **ONLY use information from the developer's answers** - NEVER invent or assume
2. If an answer is short/vague (like "melhorar X"), quote it directly - don't expand it
3. Use the DIFF to understand WHAT changed, but use ANSWERS to understand WHY
4. Be honest when information is missing: "Developer noted: [brief answer]" is better than inventing context

OUTPUT FORMAT:
Create a document with these sections (skip any section where you'd have to invent content):

## 🧠 Brain Dump Summary
2-3 sentences capturing the essence. 
- Technical Intent: ${params.plan.intent.toUpperCase()} (${params.plan.intentRationale})

## 📁 What Changed
Based on the DIFF, list the key technical changes (files, functions, configs). Be specific.

## 💡 Developer's Reasoning
ONLY what the developer explicitly said. Format as bullet points quoting or closely paraphrasing their words.

## 🔗 Deep Context (Predicted Impact)
Based on technical analysis, these areas might be affected:
${params.plan.impactedFiles.map(f => `- **${f.file}**: ${f.reason}`).join('\n') || 'No major downstream impacts predicted.'}

## ⚠️ Watch Out
Gotchas, edge cases, or warnings the developer mentioned. If none mentioned, OMIT this section entirely.

## 🔮 Future Considerations  
Only if developer mentioned next steps or improvements. Otherwise OMIT.

Output language: ${languageLabel(lang)}.
Return Markdown ONLY.`
    },
    {
      role: 'user',
      content: `## Technical Context
Branch: ${params.ctx.branch}
Commits: ${params.ctx.commits.map(c => c.message).join('; ')}
Files (${params.ctx.files.length}): ${safe(params.config, params.ctx.files.slice(0, 20).join(', '))}${params.ctx.files.length > 20 ? '...' : ''}

## Diff Preview
\`\`\`diff
${safe(params.config, diffPreview)}
\`\`\`

## Developer's Answers (use these as the PRIMARY source)
${safe(params.config, params.qa.map((p, i) => `**Q${i + 1}:** ${p.question}\n**A:** ${p.answer}`).join('\n\n'))}

Create the brain dump document. Remember: quote the developer, don't invent.`
    }
  ];

  const result = await tryProviders({
    config: params.config,
    preferred: params.preferredProvider || params.config.generation?.providers?.content || params.config.aiProvider || 'groq',
    run: async (provider) => provider.chatText({ config: params.config, messages, temperature: 0.4, maxTokens: 3000 })
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
  ctx: ChangeContext;
  qa: Array<{ question: string; answer: string }>;
  plan: DocumentPlan;
  preferredProvider?: ProviderId;
}): Promise<{ mermaid: string | null; provider: ProviderId | 'offline' }> {
  if (!params.plan.shouldGenerateDiagram || !params.plan.diagramType) {
    return { mermaid: null, provider: 'offline' };
  }

  const lang = params.config.language || 'en';
  const diffPreview = truncateDiff(params.ctx.diff);

  const messages: AIChatMessage[] = [
    {
      role: 'system',
      content: `Generate a ${params.plan.diagramType.toUpperCase()} Mermaid diagram.

PURPOSE: ${params.plan.diagramRationale || 'Visualize the change'}
FOCUS: ${params.plan.diagramFocus || 'Key components and flow'}

RULES:
- Use REAL names from the code (functions, files, classes from the diff)
- Keep it simple: 5-8 elements max
- Make it USEFUL - show relationships and flow that aren't obvious from reading code
- Return ONLY a valid Mermaid code block
- **CRITICAL SYNTAX RULE:** Arrows with labels MUST use the format: \`A -->|Label| B\`. NEVER use \`-->|Label|> B\` or other invalid combinations.

Example format:
\`\`\`mermaid
${params.plan.diagramType === 'flowchart' ? 'flowchart TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Action]\n    B -->|No| D[Other]' : ''}
${params.plan.diagramType === 'sequence' ? 'sequenceDiagram\n    participant A as Client\n    participant B as Server\n    A->>B: Request\n    B-->>A: Response' : ''}
${params.plan.diagramType === 'architecture' ? 'flowchart LR\n    subgraph Frontend\n    A[UI]\n    end\n    subgraph Backend\n    B[API]\n    end\n    A --> B' : ''}
\`\`\`

Output language for labels: ${languageLabel(lang)}.`
    },
    {
      role: 'user',
      content: `## Files Changed
${params.ctx.files.slice(0, 15).join('\\n')}

## Diff Preview
\`\`\`diff
${safe(params.config, diffPreview.slice(0, 3000))}
\`\`\`

## Developer Context
${safe(params.config, params.qa.map((p, i) => `Q: ${p.question}\\nA: ${p.answer}`).join('\\n\\n'))}

Generate the ${params.plan.diagramType} diagram now.`
    }
  ];

  const result = await tryProviders({
    config: params.config,
    preferred: params.preferredProvider || params.config.generation?.providers?.diagrams || params.config.aiProvider || 'groq',
    run: async (provider) => provider.chatText({ config: params.config, messages, temperature: 0.3, maxTokens: 1500 })
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
  ctx: ChangeContext;
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
      content: `Generate a Markdown table of type "${params.plan.tableType}".

PURPOSE: ${params.plan.tableRationale || 'Clarify the change'}
FOCUS: ${params.plan.tableFocus || 'Key information'}

TABLE TYPES:
- comparison: Before vs After, or Option A vs Option B
- tradeoffs: Pros and Cons of the approach taken
- steps: Sequential steps or process flow  
- options: Configuration options or feature flags

RULES:
- Use REAL data from the diff and developer answers
- Keep it concise: 3-6 rows max
- Make headers clear and descriptive
- Return ONLY the Markdown table (no extra text)

Output language: ${languageLabel(lang)}.`
    },
    {
      role: 'user',
      content: `## Files Changed
${params.ctx.files.slice(0, 10).join('\\n')}

## Developer Context
${safe(params.config, params.qa.map((p, i) => `Q: ${p.question}\\nA: ${p.answer}`).join('\\n\\n'))}

Generate the ${params.plan.tableType} table now.`
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
