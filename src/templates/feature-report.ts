/**
 * Template for the feature documentation report
 */
export const FEATURE_REPORT_TEMPLATE = `# {{title}}

**Branch:** {{branch}} | **Date:** {{createdAt}} | **Commits:** {{commitCount}}

---

## 🎯 O Que e Por Quê

{{what_and_why}}

---

## 🧠 Decisões Importantes

{{key_decisions}}

---

## ⚠️ Pontos de Atenção

{{gotchas}}

---

## 📝 Contexto Adicional

{{additional_context}}

---

<details>
<summary>📦 Commits & Files</summary>

### Commits
{{appendix_commits}}

### Files Modified
{{appendix_files}}

</details>

---

*Brain dump captured on {{generatedAt}}*
`;

/**
 * Question sections configuration
 */
export const QUESTION_SECTIONS = {
  core: {
    name: "Essencial",
    fields: ["what_and_why", "key_decisions", "gotchas", "additional_context"]
  }
};

/**
 * Default questions when AI fails
 */
export const DEFAULT_QUESTIONS = [
  {
    id: 'what_and_why',
    section: 'Essencial',
    question: 'Overview geral: o que fez e por quê?',
    context: 'Descreva em poucas palavras o objetivo desta feature/fix'
  },
  {
    id: 'key_decisions',
    section: 'Essencial',
    question: 'Decisões importantes? ("escolhi X porque...")',
    context: 'Quais foram as principais escolhas técnicas e suas razões?'
  },
  {
    id: 'gotchas',
    section: 'Essencial',
    question: 'Pegadinhas ou edge cases?',
    context: 'Algo que pode quebrar? Casos especiais a ter atenção?'
  },
  {
    id: 'additional_context',
    section: 'Essencial',
    question: 'Contexto adicional? TODOs, links?',
    context: 'Qualquer informação extra relevante para o futuro'
  }
];
