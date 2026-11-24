# diff-review-page

Skill do [Claude Code](https://claude.com/claude-code) que monta uma página de code review navegável (um único HTML) a partir de alterações git — working tree, staged, commit, range ou branch — inclusive **sem precisar commitar**.

- diff inline, lado a lado e "modified content"
- expandir contexto acima/abaixo e ver o arquivo inteiro
- busca no código, whitespace visível, word wrap
- rich diff de Markdown
- threads de comentário por linha ou gerais, com resposta do agente e reancoragem na linha corrigida

O parse do `git diff` é feito por script (`scripts/build-review-page.js`, sem dependências), nunca à mão.

## Requisitos

Node ≥ 14 e `git` no PATH.

## Instalação

```bash
git clone https://github.com/antoniosouto/diff-review-page.git
cd diff-review-page
node install.js --user       # ~/.claude/skills/ — vale em todo projeto
# ou: node install.js --project .   → <projeto>/.claude/skills/
# ou: node install.js --check       → só diagnostica
```

## Uso

Dentro do Claude Code, peça "monte uma página de review" / "revisar o que os agentes fizeram" — o contrato completo está em [`SKILL.md`](SKILL.md).

O gerador também roda sozinho:

```bash
node scripts/build-review-page.js --all --untracked --out /tmp/review.html --title "Review"
```

| Alvo | Flag |
|---|---|
| HEAD vs disco (staged + não-staged) | `--all` (`--untracked` inclui arquivos novos) |
| só staged | `--staged` |
| um commit | `--commit <sha>` |
| range | `--range v1..v2` |
| o que a branch tem a mais | `--branch main` |
| duas pastas sem git | `--no-index <antes> <depois>` |

Outras opções: `--repo <dir>`, `--context <n>`, `--json`.

## Threads e publicação

A persistência das threads depende de publicar a página como Artifact do Claude Code (capability `artifact`). Abrir o HTML localmente funciona para ler o diff; as threads só persistem publicado. Detalhes do ciclo (comentar → responder → republicar) no `SKILL.md`.

## Licença

MIT.
