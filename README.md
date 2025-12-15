# ReDoc - Developer Brain Dump Tool

A Bun + TypeScript CLI that captures short developer “brain dumps” via git hooks and AI-generated questions.

## 🎯 Philosophy

**A 5-minute mental snapshot, not a 30-minute manual.**

ReDoc asks a few context-aware questions (based on your pending push diff) to capture decisions, rationale, tradeoffs, and gotchas while they’re still fresh.

## 📦 Installation

**This project requires Bun.** Install it first: https://bun.sh

```bash
curl -fsSL https://bun.sh/install | bash
```

### Global install (recommended: clone + `bun link`)

The simplest way today is to clone this repository and install the `redoc` command globally via `bun link`.

```bash
# 1) Clone
git clone <REPO_URL>
cd redoc

# 2) Install deps and build
bun install
bun run build

# 3) Install globally (adds `redoc` to Bun's global bin path)
bun link

# 4) Verify
redoc --version
```

If `redoc` is not found, make sure Bun is in your PATH:

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

### Global install (npm)

Not published to npm yet. This section will be updated when it is.

## 🚀 Quick Start

### 1) Initialize in your project

```bash
cd your-project
redoc init
```

This will:
- Set where docs will be stored (`docsPath`, default: `.redoc/`)
- Configure the AI provider (Groq/Gemini/Cerebras/Ollama) and keys/URL when applicable
- Install git hooks (pre-push)

### 2) Commit normally

```bash
git add .
git commit -m "feat: add feature X"
```

### 3) Brain dump on push

```bash
git push origin feature-branch
```

O hook `pre-push` irá:
1. Detect unpushed commits
2. Generate 2–4 context-aware questions (or default questions with `--offline`)
3. Open your editor so you can answer
4. Plan and generate a Markdown document
5. Save it to `.redoc/<branch>/<version>.md` (e.g. `.redoc/main/1.0.md`)

## 📝 Commands

### `redoc init`
Initialize ReDoc in the current project.

### `redoc status`
Show unpushed commits and documentation status.

### `redoc config`
Manage configuration (API keys, project name, etc).

```bash
redoc config show                        # Show config
redoc config set groqApiKey gsk_xxx      # Set Groq API key
redoc config set geminiApiKey xxx        # Set Gemini API key
redoc config set cerebrasApiKey xxx      # Set Cerebras API key
redoc config set ollamaUrl http://localhost:11434
redoc config set ollamaModel llama3.1
redoc config set projectName my-app      # Set project name
```

### `redoc pre-push`
Run the brain dump flow manually (without pushing).

```bash
redoc pre-push --offline
redoc pre-push --verbose
```

### `redoc run`
Same flow as `pre-push`, as a manual command.

```bash
redoc run
```

### `redoc search`
Search text inside generated docs.

```bash
redoc search "jwt"
```

## 🔑 AI keys

Groq:

Get it at: https://console.groq.com

Configure with:
```bash
redoc config set groqApiKey gsk_your_key_here
```

Without a configured provider/key, you can run offline:

```bash
redoc pre-push --offline
```

## 📁 Generated structure

```
your-project/
├── .redocrc.json           # Configuração do ReDoc
└── .redoc/                 # default docsPath (local folder)
    ├── feature-branch/     # per-branch folder
    │   ├── 1.0.md          # incremental versions
    │   └── 2.0.md
    └── main/
        └── 1.0.md
```

## 📄 Example generated document

```markdown
# New JWT Authentication

**Branch:** auth-feature | **Date:** 01/15/2024 | **Commits:** 3

---

## 🎯 What and why

I implemented JWT auth to replace sessions.
The main reason was performance — sessions were causing overhead in Redis...

## 🧠 Key decisions

I chose HS256 over RS256 because we don’t need public keys...

## ⚠️ Gotchas

Be careful with token refresh — I implemented rotation, but if the user...

## 📝 Additional context

TODO: migrate old tokens in production
Useful link: https://jwt.io/introduction

---

*Brain dump captured on 01/15/2024, 14:32*
```

## 🛠️ Desenvolvimento

**This project uses Bun only.** It’s not intended for Node.js/npm/yarn-based development.

### Prerequisites

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Ensure Bun is in PATH (often done automatically)
export PATH="$HOME/.bun/bin:$PATH"

# Verify
bun --version
```

### Build

```bash
# Production build (single bundled CLI)
bun run build
```

> **Nota:** Build super rápido (~1s)! Usa o bundler nativo do Bun para criar um único arquivo executável.

### Watch mode (development)

```bash
# Development with hot reload (runs TypeScript directly)
bun run dev
```

> **Dica:** Bun executa TypeScript nativamente, sem compilação! Hot reload instantâneo.

### Tests

```bash
# Run all tests
bun test

# Watch mode
bun test --watch
```

### Testar Localmente

```bash
# Build and link
bun run build && bun link

# Create a test project
mkdir ~/test-redoc && cd ~/test-redoc
git init

# Initialize ReDoc
redoc init
```

## 🔧 Configuração

The `.redocrc.json` file contains:

```json
{
  "projectName": "my-project",
  "docsPath": ".redoc",
  "versionDocs": true,
  "language": "en",
  "aiProvider": "groq",
  "groqApiKey": "gsk_...",
  "generation": {
    "parallel": false,
    "providers": {
      "analysis": "groq",
      "content": "groq",
      "diagrams": "groq"
    }
  }
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
│   ├── config.ts         # ConfigManager
│   └── document.ts       # DocumentGenerator
├── ai/
│   ├── orchestrator.ts    # IA multi-provider + planner
│   └── providers/         # Groq/Gemini/Cerebras/Ollama
└── templates/
    └── feature-report.ts  # Template Markdown
```

## 🤝 Contributing

Contributions are welcome! See the development docs for more details.

## 📄 Licença

MIT

## 🙋 FAQ

**Q: Does ReDoc work without an API key?**
Yes. Use `--offline` to skip AI.

**Q: Are the docs stored locally?**
Yes, under `docsPath` (default: `.redoc/`) inside your repository.

**Q: Can I use a different AI provider?**
Yes: Groq, Gemini, Cerebras, or Ollama.

**Q: What happens if I skip the brain dump?**
Nothing — your unpushed commits remain until the next run/push.

---

Built for developers who hate writing docs.
