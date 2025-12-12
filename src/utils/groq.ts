import Groq from 'groq-sdk';
import { CommitVersion, GroqQuestion } from '../types.js';
import { DEFAULT_QUESTIONS } from '../templates/feature-report.js';
import { sanitizeForAI } from './sanitize.js';

export interface GroqManagerOptions {
  redactSecrets?: boolean;
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
   * Generate contextual questions based on commit versions
   */
  async generateQuestions(versions: CommitVersion[]): Promise<GroqQuestion[]> {
    const context = this.prepareContext(versions);

    const systemPrompt = `Você é um assistente que captura brain dumps concisos de desenvolvedores.

Analise os commits e diffs fornecidos e gere EXATAMENTE 4 perguntas abertas e informais para capturar o conhecimento do desenvolvedor.

As perguntas devem ter os seguintes IDs (em ordem):
1. what_and_why - O que foi feito e por quê (contexto geral)
2. key_decisions - Decisões técnicas importantes ("escolhi X porque...")
3. gotchas - Pegadinhas, edge cases, pontos de atenção
4. additional_context - Contexto adicional, TODOs, links úteis

IMPORTANTE:
- Referencie código específico dos diffs quando relevante
- Seja informal e direto
- Perguntas devem elicitar respostas de 2-5 linhas
- Inclua contexto técnico útil no campo "context"

Retorne APENAS um objeto JSON com a chave "questions" contendo um array de 4 objetos:
{
  "questions": [
    {
      "id": "what_and_why",
      "section": "Essencial",
      "question": "Sua pergunta aqui?",
      "context": "Contexto técnico relevante"
    }
  ]
}`;

    const userPrompt = `Analise estes commits e gere 4 perguntas contextuais em formato JSON:

${context}

Retorne um objeto JSON com a estrutura especificada.`;

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

      // Handle multiple possible formats
      let questions: any[];

      if (Array.isArray(parsed)) {
        questions = parsed;
      } else if (parsed.questions && Array.isArray(parsed.questions)) {
        questions = parsed.questions;
      } else if (parsed.data && Array.isArray(parsed.data)) {
        questions = parsed.data;
      } else {
        // Try to extract array from object values
        const values = Object.values(parsed);
        const arrayValue = values.find(v => Array.isArray(v));
        if (arrayValue) {
          questions = arrayValue as any[];
        } else {
          console.error('Groq response format:', JSON.stringify(parsed, null, 2));
          throw new Error('Invalid response format - no array found');
        }
      }

      if (!Array.isArray(questions) || questions.length < 4) {
        console.error('Questions array:', questions);
        throw new Error(`Invalid response format - expected 4 questions, got ${questions?.length || 0}`);
      }

      return questions.slice(0, 4);

    } catch (error) {
      console.warn('Groq API failed, using fallback questions:', error);
      return this.getFallbackQuestions();
    }
  }

  /**
   * Prepare context from commit versions for AI
   */
  private prepareContext(versions: CommitVersion[]): string {
    return versions.map(v => {
      // Limit diff size to avoid token limits
      const truncatedDiff = v.diffs.length > 2000
        ? v.diffs.substring(0, 2000) + '\n... (truncated)'
        : v.diffs;

      const safeMessage = this.redactSecrets ? sanitizeForAI(v.message).text : v.message;
      const safeFiles = this.redactSecrets ? sanitizeForAI(v.files.join(', ')).text : v.files.join(', ');
      const safeDiff = this.redactSecrets ? sanitizeForAI(truncatedDiff).text : truncatedDiff;

      return `## Version ${v.version}
**Commit:** ${v.commit}
**Message:** ${safeMessage}
**Files:** ${safeFiles}

**Diffs:**
\`\`\`diff
${safeDiff}
\`\`\`
`;
    }).join('\n---\n');
  }

  /**
   * Get fallback questions when AI fails
   */
  private getFallbackQuestions(): GroqQuestion[] {
    return DEFAULT_QUESTIONS.map(q => ({
      id: q.id,
      section: q.section,
      question: q.question,
      context: q.context
    }));
  }

  /**
   * Refine raw answers with AI to make them more professional and detailed
   */
  async refineAnswers(
    versions: CommitVersion[],
    rawAnswers: Record<string, string>
  ): Promise<Record<string, string>> {
    const context = this.prepareContext(versions);

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
