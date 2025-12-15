import Groq from 'groq-sdk';
import { sanitizeForAI } from './sanitize.js';

export interface GroqManagerOptions {
  redactSecrets?: boolean;
}

export interface QuestionGenerationContext {
  branch: string;
  commits: string[];
  files: string[];
  diff: string;
  language?: 'en' | 'pt-BR' | 'es';
}

/**
 * Manages Groq AI interactions for generating questions
 */
export class GroqManager {
  private client: Groq;
  private redactSecrets: boolean;

  constructor(apiKey: string, options: GroqManagerOptions = {}) {
    this.client = new Groq({ apiKey });
    this.redactSecrets = options.redactSecrets !== false;
  }

  /**
   * Generate contextual questions based on actual diff (PRD).
   * Returns 2-4 questions as plain strings.
   */
  async generateQuestions(ctx: QuestionGenerationContext): Promise<string[]> {
    const language = ctx.language || 'en';
    const languageLabel = language === 'pt-BR' ? 'Portuguese (Brazil)' : language === 'es' ? 'Spanish' : 'English';

    const diffPreview = this.truncateDiff(ctx.diff);

    const safeCommits = this.redactSecrets ? sanitizeForAI(ctx.commits.join('\n')).text : ctx.commits.join('\n');
    const safeFiles = this.redactSecrets ? sanitizeForAI(ctx.files.join(', ')).text : ctx.files.join(', ');
    const safeDiff = this.redactSecrets ? sanitizeForAI(diffPreview).text : diffPreview;

    const systemPrompt = `You help document a code change.

Generate 2-4 smart, contextual questions to understand the developer's reasoning (WHY, not WHAT).

Rules:
- Be specific to THIS change (use filenames, functions, behaviors seen in the diff).
- Ask about WHY, tradeoffs, edge cases, rollout, constraints, not what the code already shows.
- 2 questions for small changes, 3-4 for larger changes.
- Each question should be answerable in 1-3 sentences.
- Output language: ${languageLabel}.

Return ONLY JSON in this shape:
{ "questions": ["...", "..."] }`;

    const userPrompt = `## The Change
Branch: ${ctx.branch}
Commits:
${safeCommits}

Files changed: ${safeFiles}

Diff preview:
\n\n\`\`\`diff
${safeDiff}
\`\`\`
`;

    try {
      const completion = await this.client.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.7,
        max_tokens: 4000,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices[0]?.message?.content;

      if (!response) {
        throw new Error('No response from Groq');
      }

      const parsed = JSON.parse(response);

      const questions = Array.isArray(parsed?.questions) ? parsed.questions : null;
      if (!questions || questions.length < 2) {
        throw new Error('Invalid response format - missing questions array');
      }

      const normalized = questions
        .map((q: any) => String(q ?? '').trim())
        .filter((q: string) => q.length > 0)
        .map((q: string) => q.replace(/^\d+\s*[\).:-]\s*/, ''))
        .slice(0, 4);

      if (normalized.length < 2) {
        throw new Error('Invalid questions - too few after normalization');
      }

      return normalized;

    } catch (error) {
      console.warn('Groq API failed, using offline fallback questions:', error);
      return this.getOfflineFallbackQuestions(ctx);
    }
  }

  /**
   * Prepare context from commit versions for AI
   */
  private truncateDiff(diff: string): string {
    const maxChars = 6000;
    if (diff.length <= maxChars) return diff;
    return diff.substring(0, maxChars) + '\n... (truncated)';
  }

  /**
   * Offline fallback questions (generic, localized).
   */
  private getOfflineFallbackQuestions(ctx: QuestionGenerationContext): string[] {
    const language = ctx.language || 'en';

    // Simple heuristic: fewer questions for smaller diffs.
    const isSmall = ctx.diff.split(/\r?\n/).filter(l => l.startsWith('+') || l.startsWith('-')).length < 80;
    const count = isSmall ? 2 : 3;

    const bank: Record<'en' | 'pt-BR' | 'es', string[]> = {
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

    return bank[language].slice(0, count);
  }

  /**
   * Refine raw answers with AI to make them more professional and detailed
   */
  async refineAnswers(
    versions: any[],
    rawAnswers: Record<string, string>
  ): Promise<Record<string, string>> {
    const context = '';

    const safeRawAnswers = this.redactSecrets
      ? Object.fromEntries(
          Object.entries(rawAnswers).map(([key, value]) => [key, sanitizeForAI(value ?? '').text])
        )
      : rawAnswers;

    const systemPrompt = `Você é um assistente técnico que aprimora documentação de código.

Sua tarefa é pegar respostas brutas/concisas de desenvolvedores e transformá-las em documentação profissional, mas mantendo o tom informal.

IMPORTANTE:
- Expanda respostas muito curtas com contexto técnico relevante
- Mantenha o significado original
- Adicione detalhes técnicos baseados nos diffs fornecidos
- Use markdown para formatação (bullets, código inline, etc)
- Mantenha tom informal mas profissional
- Se a resposta for "Não" ou muito vaga, tente inferir do código

Retorne JSON com as mesmas chaves mas valores aprimorados.`;

    const userPrompt = `Com base nestes commits:

${context}

Aprimore estas respostas e retorne em formato JSON:

**O Que e Por Quê:**
${safeRawAnswers.what_and_why}

**Decisões Importantes:**
${safeRawAnswers.key_decisions}

**Pontos de Atenção:**
${safeRawAnswers.gotchas}

**Contexto Adicional:**
${safeRawAnswers.additional_context}

Retorne um objeto JSON com a seguinte estrutura:
{
  "what_and_why": "resposta aprimorada...",
  "key_decisions": "resposta aprimorada...",
  "gotchas": "resposta aprimorada...",
  "additional_context": "resposta aprimorada..."
}`;

    try {
      const completion = await this.client.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.7,
        max_tokens: 4000,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices[0]?.message?.content;

      if (!response) {
        throw new Error('No response from Groq');
      }

      const refined = JSON.parse(response);

      // Validate all required keys are present
      const requiredKeys = ['what_and_why', 'key_decisions', 'gotchas', 'additional_context'];
      const hasAllKeys = requiredKeys.every(key => key in refined);

      if (!hasAllKeys) {
        throw new Error('Missing required keys in response');
      }

      return refined;

    } catch (error) {
      console.warn('Failed to refine answers with AI, using originals:', error);
      return rawAnswers;
    }
  }

  /**
   * Validate API key format
   */
  static validateApiKey(apiKey: string): boolean {
    return apiKey.startsWith('gsk_') && apiKey.length > 20;
  }
}
