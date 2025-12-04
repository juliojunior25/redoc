# 🧪 Guia de Testes - ReDoc

## ✅ Build Concluído!

O ReDoc foi desenvolvido com sucesso. Agora vamos testar em um repositório real.

---

## 📋 Pré-requisitos

1. ✅ Bun instalado (`bun --version`)
2. ✅ Build feito (`bun run build`)
3. ✅ CLI funcionando (`bun dist/cli.js --version`)
4. ⏳ Link global (ver instruções abaixo)

---

## 🔗 Opção 1: Instalar Globalmente com Bun (Recomendado)

```bash
# No diretório do redoc
# Fazer o build
bun run build

# Instalar globalmente via bun link
bun link

# Testar (certifique-se que ~/.bun/bin está no PATH)
redoc --version
redoc --help
```

**Verificar se Bun está no PATH:**

```bash
# Ver se bun está disponível
which bun

# Se não estiver, adicione ao PATH
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

---

## 🔗 Opção 2: Usar Diretamente (Sem Instalar)

```bash
# Criar alias no seu shell (~/.zshrc ou ~/.bashrc)
alias redoc="$(pwd)/dist/cli.js"

# Recarregar shell
source ~/.zshrc  # ou source ~/.bashrc

# Testar
redoc --version
```

> **Nota:** O CLI usa `#!/usr/bin/env bun` no shebang, então o Bun precisa estar no PATH.

---

## 📦 Instalação do Bun (se necessário)

```bash
# Instalar Bun
curl -fsSL https://bun.sh/install | bash

# Adicionar ao PATH (se não foi feito automaticamente)
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Verificar instalação
bun --version
```

---

## 🚀 Teste Completo em Repositório Real

### 1. Escolher um Repositório de Teste

```bash
# Opção A: Criar repo novo para teste
mkdir ~/test-redoc-demo
cd ~/test-redoc-demo
git init
git config user.email "you@example.com"
git config user.name "Your Name"

# Opção B: Usar repo existente
cd ~/seu-projeto-git
```

### 2. Inicializar ReDoc

```bash
redoc init
```

**O que vai acontecer:**
- Pergunta nome do projeto (aceita o padrão)
- Pergunta se tem submodule existente (responda **No**)
- Pergunta nome do submodule (aceita `redocs`)
- Pergunta se tem Groq API key:
  - **Sim**: Cole sua key de https://console.groq.com
  - **Não**: Pode configurar depois
- Pergunta se quer instalar hooks (responda **Yes**)

**Resultado esperado:**
```
✅ ReDoc initialized successfully!

Next steps:
  1. Make commits as usual
  2. Before pushing, answer brain dump questions
  3. Documentation will be generated automatically
```

### 3. Verificar Instalação

```bash
# Ver config criada
cat .redocrc.json

# Ver estrutura
ls -la redocs/

# Ver hooks instalados
ls -la .git/hooks/post-commit
ls -la .git/hooks/pre-push
```

### 4. Fazer um Commit de Teste

```bash
# Criar arquivo
echo "const hello = () => console.log('Hello');" > test.js

# Commit
git add test.js
git commit -m "feat: add hello function"
```

**Resultado esperado:**
```
✓ Captured commit abc1234 as version 1.0
```

### 5. Verificar Versão Capturada

```bash
# Ver status
redoc status
```

**Deve mostrar:**
```
📊 ReDoc Status

Configuration:
  Project: test-redoc-demo
  Submodule: /path/to/redocs
  Current branch: main
  Groq API: ✓ Configured (ou ✗ Not configured)

⏳ Pending commits (1):

  1.0. abc1234 - feat: add hello function
     01/15/2024 • 1 file(s) changed
```

### 6. Fazer Mais Commits

```bash
# Commit 2
echo "const goodbye = () => console.log('Bye');" > test2.js
git add test2.js
git commit -m "feat: add goodbye function"

# Commit 3
echo "// Updated" >> test.js
git add test.js
git commit -m "refactor: improve hello"

# Ver status
redoc status
```

**Deve mostrar 3 commits pendentes (1.0, 2.0, 3.0)**

### 7. Testar Brain Dump Manual

```bash
redoc pre-push
```

**O que vai acontecer:**
1. Mostra os 3 commits pendentes
2. Pergunta se quer documentar (responda **Yes**)
3. Gera 4 perguntas (com IA se tiver API key)
4. Abre seu editor para cada pergunta
5. Gera documento final
6. Salva em `redocs/docs/main-YYYY-MM-DD.md`

**Exemplo de perguntas (com Groq):**
```
💡 Vi que você criou funções hello e goodbye em test.js

📝 Brain Dump Questions

? Overview geral: o que fez e por quê?
  [Editor abre - escreva 2-3 linhas]

? Decisões importantes? ("escolhi X porque...")
  [Editor abre - escreva 2-3 linhas]

? Pegadinhas ou edge cases?
  [Editor abre - escreva 2-3 linhas]

? Contexto adicional? TODOs, links?
  [Editor abre - escreva 2-3 linhas]
```

**Resultado esperado:**
```
✅ Brain dump captured!

Document saved to:
  /path/to/redocs/docs/main-2024-01-15.md

Review the document and push your changes.
```

### 8. Ver Documento Gerado

```bash
cat redocs/docs/main-*.md
```

**Exemplo de output:**
```markdown
# Feature: main

**Branch:** main | **Date:** 01/15/2024 | **Commits:** 3

---

## 🎯 O Que e Por Quê

Criei duas funções básicas de log para testar o sistema...

## 🧠 Decisões Importantes

Escolhi console.log porque é simples e direto...

## ⚠️ Pontos de Atenção

Nada crítico, apenas testes...

## 📝 Contexto Adicional

TODO: Adicionar mais funções no futuro

---

<details>
<summary>📦 Commits & Files</summary>

### Commits
- **abc1234** - feat: add hello function _(01/15/2024)_
- **def5678** - feat: add goodbye function _(01/15/2024)_
- **ghi9012** - refactor: improve hello _(01/15/2024)_

### Files Modified
- `test.js`
- `test2.js`

</details>

---

*Brain dump captured on 01/15/2024, 14:32*
```

### 9. Testar Comandos de Configuração

```bash
# Ver config
redoc config show

# Adicionar/Atualizar API key (se não adicionou antes)
redoc config set groqApiKey gsk_sua_chave_aqui

# Ver config novamente
redoc config show
```

### 10. Testar Workflow Completo com Push (Opcional)

```bash
# Adicionar remote (se não tiver)
git remote add origin https://github.com/seu-usuario/test-redoc-demo.git

# Tentar push (vai trigger o hook pre-push)
git push origin main

# Se não configurou remote, simule o hook:
.git/hooks/pre-push
```

---

## ✅ Checklist de Validação

Após os testes acima, verificar:

- [ ] `redoc init` criou `.redocrc.json`
- [ ] `redoc init` criou pasta `redocs/`
- [ ] `redoc init` instalou hooks em `.git/hooks/`
- [ ] Post-commit captura versões (`1.0.md`, `2.0.md`, etc)
- [ ] `redoc status` mostra commits pendentes
- [ ] `redoc pre-push` gera perguntas (AI ou default)
- [ ] Editor abre para cada pergunta
- [ ] Documento final gerado em `redocs/docs/`
- [ ] `redoc config` mostra/edita configuração
- [ ] Hooks funcionam automaticamente

---

## 🐛 Troubleshooting

### Erro: "ReDoc not initialized"
```bash
# Rodar init novamente
redoc init
```

### Erro: "Groq API key not configured"
```bash
# Adicionar key
redoc config set groqApiKey gsk_...
```

### Erro: "Not a git repository"
```bash
# Inicializar git primeiro
git init
```

### Editor não abre (Inquirer)
```bash
# Configurar editor padrão
export EDITOR=vim
# ou
export EDITOR=nano
# ou
export EDITOR="code --wait"  # VS Code
```

### Hooks não executam
```bash
# Dar permissão
chmod +x .git/hooks/post-commit
chmod +x .git/hooks/pre-push

# Testar manualmente
.git/hooks/post-commit
```

---

## 🎯 Próximos Passos

Após validar que tudo funciona:

1. **Testar em repositório real** com histórico existente
2. **Testar com branches** diferentes
3. **Testar com API key** do Groq para ver perguntas contextuais
4. **Revisar documentos** gerados
5. **Coletar feedback** sobre usabilidade

---

## 📝 Feedback

Durante os testes, anote:
- ✅ O que funcionou bem
- ❌ O que quebrou
- 💡 Ideias de melhorias
- 🐛 Bugs encontrados

---

**Boa sorte nos testes! 🚀**
