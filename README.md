# ReDoc - Developer Brain Dump Tool

Sistema CLI em TypeScript que captura "brain dumps" de desenvolvedores sobre features através de git hooks e perguntas geradas por IA.

## 🎯 Filosofia

**Snapshot mental de 5 minutos, não manual técnico de 30 minutos.**

O ReDoc intercepta seus commits e gera perguntas contextuais usando IA (Groq/LLaMA 3.3 70B) para capturar seu conhecimento enquanto está fresco na memória.

## 📦 Instalação

**Este projeto requer Bun.** [Instale o Bun](https://bun.sh) primeiro:

```bash
curl -fsSL https://bun.sh/install | bash
```

### Instalação Global (via npm - em breve)

```bash
npm install -g @redoc/cli
```

### Desenvolvimento Local

```bash
# Clonar e configurar
git clone <repo>
cd redoc
bun install
bun run build
bun link

# Testar
redoc --version
```

## 🚀 Quick Start

### 1. Inicializar no Projeto

```bash
cd seu-projeto
redoc init
```

O comando irá:
- Criar um submodule para armazenar documentação
- Configurar git hooks (post-commit, pre-push)
- Pedir sua Groq API key (opcional, mas recomendado)

### 2. Fazer Commits Normalmente

```bash
git add .
git commit -m "feat: nova funcionalidade X"
```

O hook `post-commit` captura automaticamente o diff e metadados.

### 3. Brain Dump no Push

```bash
git push origin feature-branch
```

O hook `pre-push` irá:
1. Mostrar commits pendentes
2. Gerar 4 perguntas contextuais sobre seu código
3. Abrir editor para você responder
4. Gerar documento Markdown de 1 página
5. Commitar no submodule

## 📝 Comandos

### `redoc init`
Inicializa ReDoc no projeto atual.

### `redoc status`
Mostra commits pendentes e documentação existente.

### `redoc config`
Gerencia configuração (API keys, projeto, etc).

```bash
redoc config show                        # Ver configuração
redoc config set groqApiKey gsk_xxx      # Definir API key
redoc config set projectName meu-app     # Definir nome do projeto
```

### `redoc pre-push`
Executa brain dump manualmente (sem fazer push).

## 🔑 Groq API Key

Obtenha gratuitamente em: [https://console.groq.com](https://console.groq.com)

Configure via:
```bash
redoc config set groqApiKey gsk_sua_chave_aqui
```

Sem API key, o ReDoc usa perguntas padrão (menos contextuais).

## 📁 Estrutura Gerada

```
seu-projeto/
├── .redocrc.json           # Configuração do ReDoc
├── redocs/                 # Submodule (ignorado no git principal)
│   ├── feature-branch/     # Diretório por branch
│   │   ├── 1.0.md         # Versões individuais dos commits
│   │   ├── 2.0.md
│   │   └── 3.0.md
│   └── docs/              # Documentação final (brain dumps)
│       ├── feature-branch-2024-01-15.md
│       └── main-2024-01-10.md
```

## 📄 Exemplo de Documento Gerado

```markdown
# Nova Autenticação JWT

**Branch:** auth-feature | **Date:** 01/15/2024 | **Commits:** 3

---

## 🎯 O Que e Por Quê

Implementei autenticação JWT para substituir sessions.
O motivo foi performance - sessions estavam causando overhead no Redis...

## 🧠 Decisões Importantes

Escolhi HS256 em vez de RS256 porque não precisamos de chaves públicas...

## ⚠️ Pontos de Atenção

Cuidado com o token refresh - implementei rotação mas se o usuário...

## 📝 Contexto Adicional

TODO: Migrar tokens antigos em produção
Link útil: https://jwt.io/introduction

---

*Brain dump captured on 01/15/2024, 14:32*
```

## 🛠️ Desenvolvimento

**Este projeto usa Bun exclusivamente.** Não é compatível com Node.js/npm/yarn para desenvolvimento.

### Pré-requisito

```bash
# Instalar Bun
curl -fsSL https://bun.sh/install | bash

# Adicionar ao PATH (já é feito automaticamente)
export PATH="$HOME/.bun/bin:$PATH"

# Verificar
bun --version
```

### Build

```bash
# Build para produção (bundle único de ~1.6MB)
bun run build
```

> **Nota:** Build super rápido (~1s)! Usa o bundler nativo do Bun para criar um único arquivo executável.

### Watch Mode (Desenvolvimento)

```bash
# Desenvolvimento com hot reload (executa TypeScript diretamente)
bun run dev
```

> **Dica:** Bun executa TypeScript nativamente, sem compilação! Hot reload instantâneo.

### Testes

```bash
# Rodar todos os testes
bun test

# Watch mode
bun test --watch
```

### Testar Localmente

```bash
# Build e link
bun run build && bun link

# Criar projeto teste
mkdir ~/test-redoc && cd ~/test-redoc
git init

# Inicializar ReDoc
redoc init
```

## 🔧 Configuração

O arquivo `.redocrc.json` contém:

```json
{
  "projectName": "meu-projeto",
  "submodulePath": "/caminho/para/redocs",
  "groqApiKey": "gsk_...",
  "aiProvider": "groq"
}
```

## 📚 Arquitetura

```
src/
├── cli.ts                 # Entry point CLI
├── types.ts               # TypeScript interfaces
├── commands/              # Comandos CLI
│   ├── init.ts
│   ├── post-commit.ts
│   ├── pre-push.ts
│   ├── status.ts
│   └── config.ts
├── utils/                 # Utilitários principais
│   ├── git.ts            # GitManager
│   ├── groq.ts           # GroqManager (IA)
│   ├── config.ts         # ConfigManager
│   └── document.ts       # DocumentGenerator
└── templates/
    └── feature-report.ts  # Template Markdown
```

## 🤝 Contribuindo

Contribuições são bem-vindas! Veja o arquivo de desenvolvimento para mais detalhes.

## 📄 Licença

MIT

## 🙋 FAQ

**Q: O ReDoc funciona sem API key?**
Sim! Usa perguntas padrão menos contextuais.

**Q: Os commits ficam salvos localmente?**
Sim, no submodule `redocs/` que é ignorado pelo git principal.

**Q: Posso usar outro provider de IA?**
Atualmente só Groq, mas OpenAI está planejado.

**Q: O que acontece se eu pular o brain dump?**
Nada! Os commits ficam pendentes até o próximo push.

---

**Feito com ❤️ para desenvolvedores que odeiam escrever documentação.**
