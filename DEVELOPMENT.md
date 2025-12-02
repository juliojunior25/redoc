# Guia de Desenvolvimento - ReDoc

Este documento é para desenvolvedores que querem contribuir ou estender o ReDoc.

## 🏗️ Estrutura do Código

### Camadas Principais

1. **CLI Layer** (`src/cli.ts`)
   - Entry point do programa
   - Registra comandos usando Commander.js
   - Roteamento para command handlers

2. **Commands Layer** (`src/commands/`)
   - Handlers específicos para cada comando
   - Lógica de interação com usuário (Inquirer)
   - Orquestração de utilidades

3. **Utils Layer** (`src/utils/`)
   - Managers reutilizáveis
   - Lógica de negócio
   - Integrações (Git, Groq, etc)

4. **Templates Layer** (`src/templates/`)
   - Templates de documentação
   - Configuração de perguntas
   - Formatação de output

### Fluxo de Dados

```
User Command
    ↓
CLI (cli.ts)
    ↓
Command Handler (commands/*.ts)
    ↓
Utils (utils/*.ts)
    ↓
Git / Groq API / File System
```

## 📋 Adicionando Nova Funcionalidade

### Exemplo: Adicionar Nova Pergunta

1. **Editar Template** (`src/templates/feature-report.ts`)

```typescript
export const FEATURE_REPORT_TEMPLATE = `
...
## 🔒 Segurança
{{security_considerations}}
...
`;

export const QUESTION_SECTIONS = {
  core: {
    fields: [..., "security_considerations"]
  }
};

export const DEFAULT_QUESTIONS = [
  ...,
  {
    id: 'security_considerations',
    section: 'Essencial',
    question: 'Tem alguma consideração de segurança?',
    context: 'Vulnerabilidades, validações, autenticação...'
  }
];
```

2. **Atualizar Groq Prompt** (`src/utils/groq.ts`)

```typescript
const systemPrompt = `Gere 5 perguntas:
...
5. security_considerations - Considerações de segurança
`;
```

3. **Atualizar DocumentGenerator** (`src/utils/document.ts`)

```typescript
content = content.replace('{{security_considerations}}',
  this.formatAnswer(answers.security_considerations));
```

4. **Atualizar Tipos** (`src/types.ts`)

```typescript
export interface BrainDumpAnswers {
  // ...
  security_considerations: string;
}
```

### Exemplo: Adicionar Novo Comando

1. **Criar Command Handler** (`src/commands/export.ts`)

```typescript
import chalk from 'chalk';

export async function exportCommand(format: string): Promise<void> {
  console.log(chalk.blue(`Exporting to ${format}...`));
  // Implementação
}
```

2. **Registrar no CLI** (`src/cli.ts`)

```typescript
program
  .command('export <format>')
  .description('Export documentation to different formats')
  .action(async (format) => {
    await exportCommand(format);
  });
```

## 🧪 Testando

### Setup de Testes

```bash
npm install --save-dev jest @types/jest ts-jest
npx ts-jest config:init
```

### Estrutura de Teste

```
tests/
├── unit/
│   ├── git.test.ts
│   ├── groq.test.ts
│   └── document.test.ts
├── integration/
│   └── workflow.test.ts
└── fixtures/
    ├── sample-commits.json
    └── sample-config.json
```

### Exemplo de Teste Unitário

```typescript
// tests/unit/git.test.ts
import { GitManager } from '../../src/utils/git';

describe('GitManager', () => {
  it('should get current branch', async () => {
    const git = new GitManager('/test');
    const branch = await git.getCurrentBranch();
    expect(branch).toBeDefined();
  });
});
```

### Rodando Testes

```bash
npm test                    # Rodar todos
npm run test:watch          # Watch mode
npm run test:coverage       # Com coverage
```

## 🔍 Debugging

### Debug de Git Hooks

Os hooks salvam logs em `.git/hooks/*.log`:

```bash
# Ver logs do post-commit
tail -f .git/hooks/post-commit.log

# Ver logs do pre-push
tail -f .git/hooks/pre-push.log
```

### Debug de Groq API

```typescript
// Adicionar no groq.ts
console.log('Groq Request:', {
  model: 'llama-3.3-70b-versatile',
  messages,
  temperature: 0.7
});

console.log('Groq Response:', response);
```

### Debug de Arquivos Gerados

```bash
# Ver config
cat .redocrc.json | jq

# Ver versões
ls -la redocs/feature-branch/

# Ver docs finais
ls -la redocs/docs/
```

## 🎨 Convenções de Código

### Naming

```typescript
// Classes: PascalCase
class GitManager { }

// Functions: camelCase
async function getCurrentBranch() { }

// Files: kebab-case
git-manager.ts

// Interfaces: PascalCase
interface RedocConfig { }
```

### Error Handling

```typescript
try {
  await operation();
  spinner.succeed('Success!');
} catch (error) {
  spinner.fail('Failed');
  console.error(chalk.red('Error:'), error.message);
  process.exit(1);
}
```

### Async/Await

Sempre use async/await, nunca promises com `.then()`:

```typescript
// ✅ BOM
const result = await gitManager.getCurrentBranch();

// ❌ RUIM
gitManager.getCurrentBranch().then(result => { });
```

### Spinner Pattern

```typescript
const spinner = ora('Loading...').start();
try {
  await operation();
  spinner.succeed('Success!');
} catch (error) {
  spinner.fail('Failed');
  throw error;
}
```

## 📦 Build e Release

### Build Local

```bash
npm run build              # Compila TypeScript
npm link                   # Link global para testes
```

### Publicar no NPM

```bash
npm version patch          # Incrementa versão
npm run build             # Build production
npm publish               # Publica (precisa estar logado)
```

## 🐛 Debugging Comum

### "ReDoc not initialized"

Usuário não rodou `redoc init`. Verificar:

```bash
ls -la .redocrc.json
```

### "Groq API failed"

API key inválida ou rate limit. Verificar:

```bash
redoc config get groqApiKey
```

### Git hooks não executam

Permissões incorretas. Verificar:

```bash
ls -la .git/hooks/
chmod +x .git/hooks/post-commit
chmod +x .git/hooks/pre-push
```

### Editor não abre no Inquirer

`$EDITOR` não configurado. Definir:

```bash
export EDITOR=vim
# ou
export EDITOR=nano
```

## 🔄 Fluxo Completo

1. **User runs:** `git commit -m "feat: X"`
2. **Git calls:** `.git/hooks/post-commit`
3. **Hook runs:** `redoc post-commit`
4. **PostCommit:** Captura diff, cria `redocs/branch/1.0.md`
5. **User runs:** `git push`
6. **Git calls:** `.git/hooks/pre-push`
7. **Hook runs:** `redoc pre-push`
8. **PrePush:** Lê versões, chama Groq, coleta respostas
9. **DocumentGenerator:** Gera `redocs/docs/branch-2024-01-15.md`
10. **GitManager:** Commit no submodule

## 📚 Recursos Úteis

- [Commander.js Docs](https://github.com/tj/commander.js)
- [Inquirer.js Docs](https://github.com/SBoudrias/Inquirer.js)
- [Simple-git Docs](https://github.com/steveukx/git-js)
- [Groq API Docs](https://console.groq.com/docs)
- [Chalk Docs](https://github.com/chalk/chalk)
- [Ora Spinner](https://github.com/sindresorhus/ora)

## 💡 Ideias Futuras

### Prioridade Alta
- [ ] Testes unitários completos
- [ ] Retry logic com backoff para Groq
- [ ] Validação de inputs com Zod
- [ ] Error messages mais claras

### Prioridade Média
- [ ] Suporte a OpenAI
- [ ] Templates customizáveis
- [ ] Export para HTML/PDF
- [ ] Search em docs antigas

### Prioridade Baixa
- [ ] Web UI para visualizar docs
- [ ] Integração com Jira/Linear
- [ ] Team collaboration features
- [ ] Analytics de documentação

## 🤝 Contribuindo

1. Fork o repositório
2. Crie branch (`git checkout -b feature/nova-feature`)
3. Commit mudanças (`git commit -m 'feat: adiciona X'`)
4. Push para branch (`git push origin feature/nova-feature`)
5. Abra Pull Request

### Commit Message Convention

```
feat: nova funcionalidade
fix: correção de bug
docs: documentação
refactor: refatoração
test: testes
chore: manutenção
```

---

**Happy Coding! 🚀**
