# ReDoc - Developer Brain Dump Tool

A Bun + TypeScript CLI that captures short developer “brain dumps” via git hooks and AI-generated questions.

## 🎯 Philosophy

**A 5-minute mental snapshot, not a 30-minute manual.**

ReDoc asks a few context-aware questions (based on your pending push diff or working directory changes) to capture decisions, rationale, tradeoffs, and gotchas while they’re still fresh.

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

## 🚀 Quick Start (Human Mode)

### 1) Initialize in your project

```bash
cd your-project
redoc init
```

This will:
- Set where docs will be stored (`docsPath`, default: `.redoc/`)
- Configure the AI provider (Groq/Gemini/Cerebras/Ollama) and keys/URL when applicable
- Install git hooks (pre-push)

### 2) Commit normally (or just work on files)

```bash
git add .
git commit -m "feat: add feature X"
```

### 3) Brain dump

You can trigger the brain dump in two ways:

**Option A: On Push (Automatic)**
```bash
git push origin feature-branch
```
The `pre-push` hook will detect unpushed commits and start the interactive session.

**Option B: Manual Run**
```bash
redoc run
```
This works even with **uncommitted changes** in your working directory!

## 🤖 Agent Mode (Headless / CI / AI)

ReDoc has a special mode for AI Agents and CI/CD pipelines where no interactive terminal (TTY) is available.

### Workflow for Agents

1.  **Export Questions:**
    Generate questions based on the current diff (committed or not) and save them to a JSON file.
    ```bash
    redoc run --export-questions questions.json
    ```

2.  **Answer Questions:**
    The agent reads `questions.json` and creates an `answers.json` file with the following format:
    ```json
    {
      "answers": [
        {
          "question": "What was the trigger...?",
          "answer": "The trigger was..."
        },
        ...
      ]
    }
    ```

3.  **Generate Documentation:**
    Feed the answers back to ReDoc to generate the final Markdown.
    ```bash
    redoc run --answers answers.json
    ```

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
redoc config set ollamaUrl http://localhost:11434
```

### `redoc run`
Manual brain dump.

```bash
redoc run                                # Interactive
redoc run --export-questions q.json      # Agent Mode (Step 1)
redoc run --answers a.json               # Agent Mode (Step 2)
```

### `redoc search`
Search text inside generated docs.

```bash
redoc search "jwt"
```

## 🔑 AI keys

Groq:
Get it at: https://console.groq.com
Configure with: `redoc config set groqApiKey gsk_...`

## 📁 Generated structure

```
your-project/
├── .redocrc.json           # Configuração do ReDoc
└── .redoc/                 # default docsPath (local folder)
    ├── feature-branch/     # per-branch folder
    │   ├── 1.0.md          # incremental versions
    └── main/
        └── 1.0.md
```

## 🛠️ Development

**This project uses Bun only.**

### Build

```bash
bun run build
```

### Watch mode

```bash
bun run dev
```

### Tests

```bash
bun test
```

## 📄 License

MIT

---

Built for developers who hate writing docs.