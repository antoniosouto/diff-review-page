---
name: diff-review-page
description: |
  Monta uma página de code review navegável (HTML autocontido) a partir de alterações git — working tree, staged, um commit, range ou branch — com diff inline/lado a lado, expandir contexto, arquivo inteiro, busca no código, rich diff de Markdown e threads de comentário por linha.
  Use quando eu pedir "revisar as alterações", "página de review", "ver o diff", "revisar o que os agentes fizeram", "montar review", "diff review", "revisar antes do commit", ou quando eu quiser inspecionar visualmente mudanças (comitadas ou não).
  Do NOT use for: revisão textual do código em prosa sem página (responda direto no chat), auditoria de qualidade de código (use code-reviewer), verificação estrutural de um plugin de squad (use a selfcheck do squad).
metadata:
  version: 1.3.1
allowed-tools: Read, Grep, Glob, Bash, Edit, Artifact
---

# Página de code review a partir de git

## Instalação

Um instalador para as três plataformas, em Node (que já é requisito do gerador) —
dois scripts em shell diferentes só teriam duas chances de divergir:

```bash
node install.js              # interativo: pergunta onde instalar
node install.js --user       # <home>/.claude/skills/ — vale em todo projeto
node install.js --project .  # <projeto>/.claude/skills/ — só neste repo
node install.js --check      # só diagnostica (Node, git, integridade do pacote)
```

**Onde faz sentido instalar.** O harness descobre skills em dois lugares: `<home>/.claude/skills/`
(escopo de usuário) e `<projeto>/.claude/skills/` (escopo de projeto, versionável com o time).
Caminho arbitrário **não é varrido** — a skill fica no disco e nunca é encontrada; o instalador
aceita, mas avisa e explica que serve só para montar um pacote a ser copiado depois.

Para esta skill o escopo de usuário é o natural: revisar diff serve em qualquer projeto.

O instalador valida o ambiente antes de copiar (Node ≥ 14, `git` no PATH, pacote completo),
substitui apenas `SKILL.md`, `scripts/` e `templates/` quando já existe instalação — preservando
o resto do diretório — e ao final confere que o gerador passa em `node --check` e que o template
manteve seus pontos de injeção. Sem terminal interativo exige alvo explícito e `--force` para
sobrescrever, em vez de pendurar uma pergunta.

Gera um HTML autocontido (sem CDN, sem dependências) com as features de revisão do
GitHub/Azure DevOps: inline · lado a lado · modified content, expandir contexto acima/abaixo,
arquivo inteiro, busca no código, whitespace visível, word wrap, rich diff de Markdown,
navegação entre diferenças e threads de comentário por linha ou gerais.

**O parse do diff é feito por script, nunca à mão.** Montar hunks manualmente erra números de
linha e é caro; o gerador lê o `git diff` de verdade.

## Fluxo

### 1. Descubra o que revisar

Se o pedido não disser, olhe o estado do repo antes de escolher:

```bash
git status --short
git log --oneline -5
```

| Situação | Alvo |
|----------|------|
| "revisa o que você/os agentes fizeram agora" | `--all` (HEAD vs disco — pega staged e não-staged) |
| "revisa antes de eu commitar" | `--all --untracked` |
| "só o que está staged" | `--staged` |
| "revisa esse commit" | `--commit <sha>` |
| "revisa o que essa branch tem a mais" | `--branch main` |
| "revisa entre essas duas versões" | `--range v1..v2` |
| **pasta sem git** ou "compara com a versão antiga" | `--no-index <antes> <depois>` |

Arquivo novo só aparece com `--untracked` (o `git diff` não vê arquivo não rastreado).

**`--no-index` para diretório não versionado.** Nem todo alvo é repo git — pasta de documentos,
plugin gerado, backup extraído. `git diff --no-index` compara duas árvores no disco e funciona
fora de repositório:

```bash
node .../build-review-page.js --no-index /caminho/antes /caminho/depois --out /tmp/rev.html
```

Precisa de uma cópia do estado anterior. Se não houver, procure onde ele existe (uma cópia em
outro diretório, um `.bak`, um tar de backup) antes de dizer que não é possível. Os paths na
página saem relativos à árvore "depois".

### 2. Gere a página

```bash
node ~/.claude/skills/diff-review-page/scripts/build-review-page.js \
  --all --untracked \
  --out /tmp/review-<contexto>.html \
  --title "Review · <o que é>"
```

O script imprime em stderr: alvo, número de arquivos, `+/−` e quantos ficaram sem diff
navegável (binários e removidos). **Leia esse resumo** — se disser 0 arquivos, o alvo estava
errado.

Opções úteis: `--repo <dir>` (repo fora do cwd), `--context <n>` (linhas de contexto por
hunk, default 3), `--json` (só os dados, para depurar o parse).

### 3. Preencha o que o script não sabe

O gerador produz a estrutura; o valor da revisão está no que só você escreve. Edite o HTML
gerado:

1. **O "Por quê" de cada arquivo.** Cada card nasce com
   `<span class="why-todo">descreva aqui a intenção da mudança</span>`. Troque por uma frase
   que diga a INTENÇÃO, não o que o diff já mostra:
   - Ruim: "alterado o método listar" (o diff mostra isso)
   - Bom: "cleanup de subscription: a tela fica aberta por horas e acumulava leak"
2. **Agrupe por tema** quando houver mais de ~4 arquivos. O gerador cria uma `<section
   class="category">` única; divida em várias, cada uma com `<span class="tag critical">` ou
   `<span class="tag qa">` e um `<h2>`. Ordene por severidade — o que pode quebrar primeiro.
3. **Ajuste a lede** se o contexto merecer mais que a frase automática.

Use `grep -n 'why-todo' <arquivo>` para achar todos os pendentes e não deixar nenhum.

### 4. Publique

Sempre com a capability `artifact` — é ela que deixa a página salvar as threads:

```
Artifact(file_path: "/tmp/review-<contexto>.html", favicon: "🔀",
         capabilities: {"artifact": {}})
```

O favicon é sempre **🔀** (remete a diff/merge) — mantenha igual em todo review e em
toda republicação, para a aba ser reconhecível.

Entregue o link.

## Ciclo de threads: você comenta, eu respondo

A página persiste as threads em `data/threads.json` (files form do `artifact.publish`), então
elas sobrevivem a recarregar a aba e aparecem em outras abas. O chip na toolbar mostra
`salvando…` / `salvo` / `só nesta aba`.

**Cada lado escreve num lugar só**, e é isso que evita conflito:

| Quem | Escreve em |
|------|-----------|
| Você (pela página) | `data/threads.json` |
| Eu (Claude Code, republicando) | bloco `#agent-replies` no HTML |

### Como eu recebo as threads

**Não consigo ler `data/threads.json` por HTTP** — `WebFetch` na URL do artefato devolve o
HTML da página, não os arquivos de dados. Testado e confirmado. Então o caminho é:

1. Você clica em **⧉ (copiar threads)** na toolbar e cola o JSON no chat; **ou**
2. Você me diz o que quer que eu resolva e eu leio o `#agent-replies` + o HTML publicado via
   `WebFetch` para ter o contexto dos arquivos

Não invente o conteúdo das threads a partir do HTML publicado — ele não as contém.

**Imagens não vão no JSON copiado.** Elas ficam salvas na página (dentro de
`data/threads.json`, como data URI) e aparecem nas threads, mas o botão de copiar as
substitui por uma contagem — `"images": "2 imagem(ns) anexada(s) — colar no chat"`. O motivo
é duplo: um data URI base64 é grande demais para colar como texto, e chega até o agente
como texto, não como imagem — ele não veria nada. Para eu ver um print, **cole a imagem
direto no chat** (o Claude Code aceita imagem nativamente); o JSON serve para localizar a
thread, o arquivo e a linha.

Se o chip mostrar "Threads grandes demais para salvar", é acúmulo de imagens no arquivo de
dados — remover um anexo resolve.

### Como eu respondo

Para cada thread que eu tratar:

1. **Aja no código primeiro.** Edite os arquivos reais do repo. A resposta descreve o que
   mudou, não uma promessa

⚠ **Se você mudou código, a página tem de mostrar essa mudança — e NUNCA commite para isso.**

Erro cometido de verdade, duas vezes seguidas: primeiro respondi "feito" numa thread enquanto
a página exibia o diff de um único commit (minha alteração estava no working tree, fora
daquele alvo) — o revisor leu "feito" sem ter como ver o código. Depois "resolvi" commitando,
o que é pior: **commitar é decisão do usuário, não passo de ferramenta.**

O certo: regere com **`--all --untracked`**, que compara HEAD com o disco e portanto inclui
tudo que você acabou de editar, staged ou não. Trabalho não commitado é o caso NORMAL desta
skill, não a exceção. Só use `--commit`/`--range` quando o alvo pedido for explicitamente um
commit ou intervalo.
2. **Monte o bloco de respostas** e substitua o `#agent-replies` no HTML local:

```json
{"v":1,"replies":[
  {"threadId":"t-abc123-x9",
   "author":"Claude",
   "at":"2026-08-20T19:05:00.000Z",
   "text":"Concordo — o catch engolia a exceção. Passei a relançar como ServicoException.",
   "action":"corrigido · ContaService.java:88",
   "status":"resolvido"}
]}
```

| Campo | Papel |
|-------|-------|
| `threadId` | id mostrado na thread (o texto pequeno ao lado de "linha N") |
| `text` | sua resposta. Se você **discorda**, diga por quê aqui — discordar é uso legítimo |
| `action` | o que mudou, **sempre com `arquivo:linha`**. Omita se não mexeu em nada |
| `status` | `resolvido` (tratado), `respondido` (respondi mas depende dele), ou omita |

⚠ **`action` sem número de linha não cumpre a função do campo.** Ele existe para o revisor
achar a mudança sem procurar. Escrevi `SQUAD-DNA.md §8: nota sobre reconciliação` num
documento de 1600 linhas e o revisor teve de perguntar onde estava — citar a seção não
resolve num arquivo grande, e "§8" pode cobrir centenas de linhas.

O formato certo, e vale para prosa igual a código:

```
"action": "adicionado · SQUAD-DNA.md:1378-1383 · nota sobre reconciliação embutida"
"action": "corrigido · src/app/fatura.service.ts:23-34 · autorização antes do POST"
"action": "criado · scripts/migrate-squad-state.js (195 linhas)"
```

Levante o número **depois** de editar (as linhas mudam com a própria edição) e confira com
`grep -n` antes de escrever a resposta — número errado é pior que número ausente, porque o
revisor vai ao lugar errado e conclui que você não fez.

⚠ **A linha citada no `action` REANCORA a thread** (v1.2.0). Não é mais só um link: se o
`arquivo:linha` aponta para o mesmo arquivo da thread, a página move a thread para lá e
expande o contexto do hunk para revelá-la, mostrando `linha 1378 · era 279`. O motivo é que
depois da correção o interesse do revisor muda — de "onde eu comentei" para "onde ficou o
conserto". Duas consequências para você:

- **número errado agora desloca a discussão**, não só o link. Confira com `grep -n`.
- ⚠ **a linha tem de pertencer AO SNAPSHOT DESTA PÁGINA.** Se a correção gerou uma página
  nova (porque mudou o próprio arquivo que a página mostra), o número de linha atual aponta
  para outro conteúdo na página antiga, e reancorar leva a thread para o lugar errado. Nesse
  caso: `action` sem número, e o link da página nova no texto da resposta.
- se você mexeu em **outro** arquivo para resolver a thread, cite-o normalmente: a
  reancoragem só ocorre quando o arquivo citado é o da thread, então a thread fica onde
  está e o `arquivo:linha` continua servindo de link.

3. **Ecoe as threads recebidas no bloco `#seed-threads`** — obrigatório, não opcional:

```json
{"v":1,"threads":[ ...as threads exatamente como vieram no JSON que ele colou... ]}
```

4. **Republique no mesmo URL** — `Artifact` com o mesmo `file_path`.

⚠ **Por que o passo 3 existe** (aprendido errando): republicar a página usa a **html form**
do publish, que substitui a versão inteira e **leva embora o `data/threads.json`**. Só a
*files form* preserva paths que não nomeia — e a files form é da página, não sua. Sem ecoar
as threads na semente, **responder apaga os comentários** e a discussão volta vazia.

A página funde semente + arquivo de dados por `id`: o arquivo ganha nos detalhes (imagens,
mensagens feitas depois de ele copiar o JSON) e a semente garante o resgate se o arquivo foi
perdido. Se a semente trouxer mais do que o arquivo, a página re-salva para consolidar.

O que ainda se perde: thread criada **depois** de ele copiar o JSON e **antes** da sua
republicação — ela não está na semente nem sobrevive à troca de versão. Avise-o para copiar
as threads imediatamente antes de pedir sua ação.

### ⚠⚠ NUNCA republique por iniciativa própria — publique em URL novo

Republicar é seguro **só** quando você está aplicando respostas a threads que ele **acabou
de te passar** por JSON: aí você tem o conteúdo para ecoar na semente.

Toda outra razão para republicar — melhorar o template, subir a versão da skill, corrigir
CSS, entregar feature nova — **é iniciativa sua, e a página pode ter threads que você não
conhece.** Não há como checar: `WebFetch` não lê `data/threads.json`. Republicar às cegas
apaga a discussão dele, e ela não volta.

**Regra:** mudança que é iniciativa sua → **publique como página NOVA** (novo `file_path`,
sem `url`), entregue o link novo e diga que a antiga segue intacta com as threads. O custo é
uma página a mais na galeria; o custo do erro é a discussão dele apagada.

Eu quebrei isso: republiquei uma página só para entregar `editar/remover`, sem pedir o JSON
antes. As threads dela sumiram e não havia como recuperar.

A resposta do agente aparece destacada, com badge "agente", e a `action` num bloco verde.

**Editar e remover mensagem** (v1.3.0): cada mensagem **sua** tem `editar` e `remover` no
cabeçalho (aparecem no hover). Editar abre um textarea in-place — `Ctrl+Enter` salva, `Esc`
cancela — e marca a mensagem como "editado" (texto igual não marca). Remover pede
confirmação em **dois cliques** no próprio botão, não `window.confirm`: o artefato roda em
iframe sandbox, onde modal nativo pode ser bloqueado, e aí a remoção falharia em silêncio.
Remover a última mensagem de uma thread **apaga a thread** — o botão avisa (`apagar
thread?`), porque thread sem mensagem sua fica como âncora fantasma no diff.

⚠ Mensagem do agente **não** é editável: ela vem de `#agent-replies`, que a página não
escreve, então a edição seria desfeita na próxima republicação. O discriminador é
`t.msgs.indexOf(m)` — as do agente são objetos sintetizados por `messagesOf()` e dão −1.

**Filtro por status** (`Threads ▾`): filtra **threads**, nunca o diff. Até a v1.2.0 ele
escondia os cards sem thread do status pedido — com "Abertas (0)" a página inteira sumia e
parecia quebrada. Hoje os diffs ficam, as threads fora do status somem, o índice do dropdown
lista **só** o que o filtro deixou à vista (antes listava todas, contradizendo o próprio
rótulo) e o índice mostra a linha **efetiva** da thread, já reancorada. Para esconder arquivo,
o gesto é colapsar, não filtrar.

**Navegação entre threads** (v1.2.0): os botões `⤒`/`⤓` na toolbar percorrem as threads na
ordem em que aparecem na página (inline no diff primeiro, depois as gerais do rodapé),
abrindo o card colapsado quando necessário. O dropdown "Threads" continua servindo para
saltar direto para uma específica.

**Status efetivo:** a última palavra do agente vence a marcação manual. Se ele marcou
"aberto" e eu respondi com `status: resolvido`, a thread mostra resolvido.

⚠ Se você regenerar a página do zero (rodar o gerador de novo), o `data/threads.json` do
artefato antigo continua no artefato antigo — publique num `file_path` novo se quiser um
review separado, ou reaproveite o mesmo para manter o histórico.

## Anti-patterns

**Montar os hunks à mão.** Erra número de linha, e o erro só aparece quando alguém clica em
"expandir contexto" e vê código de outro lugar. Sempre o script.

**Entregar com os "Por quê" em branco.** Uma página de diff sem intenção declarada é
`git diff` com CSS — o revisor não ganha nada. Se você não sabe a intenção de uma mudança,
diga isso no card em vez de inventar ("mudança feita por <agente>; intenção não registrada").

**Categoria única com 15 arquivos.** Sem agrupamento o revisor não sabe por onde começar.
Agrupe e ordene por risco.

**Publicar sem abrir o resumo do stderr.** Se o script disse "sem diff navegável: 4", há
quatro cards vazios na página e você precisa explicar por quê (binário? removido?).

## Verificação antes de publicar

```bash
# JS do HTML gerado é válido?
awk '/^<script>$/{f=1;next} /^<\/script>$/{f=0} f' <arquivo> > /tmp/_chk.js && node -c /tmp/_chk.js

# Nenhum placeholder do template escapou?
grep -o '__[A-Z_]*__' <arquivo> | sort -u

# Nenhum "Por quê" pendente?
grep -c 'why-todo' <arquivo>
```

Os três devem sair limpos: JS OK, nenhum `__PLACEHOLDER__`, zero `why-todo`.

### ⚠ Antes de criar classe CSS, grepe o nome — colisão já custou 3 bugs

O template tem ~3600 linhas e nomes genéricos já ocupados. Três vezes o mesmo tipo de falha:

| Sintoma | Causa |
|---|---|
| lado-a-lado vazio | `.diffbody[data-mode="split"] .diff-line` (descendente) escondia as linhas dentro das colunas |
| `<hr>` desenhando caixa sobre a legenda | `hr` sem estilo próprio no rich diff |
| **botão "Salvar" sem texto** | reusei `.primary`, que já existe em `button.primary` com `background: var(--accent)`; minha regra sobrescreveu só `color`, também para accent → laranja no laranja |

Duas regras que saem disso:

1. **`grep -n "\.nome-da-classe" review-page.html` antes de criar.** Se já existe, use outro
   nome — não "sobrescreva um pouquinho".
2. **Botão ou chip novo declara `background` E `color` juntos**, sempre. Herdar metade da
   aparência de outra regra é como o texto invisível acontece.

### ⚠ `node -c` NÃO pega erro de runtime — e um deles derrubou a página inteira

Aconteceu de verdade: passei `rootMargin: '-5.5rem ...'` a um `IntersectionObserver`. A API
aceita **apenas px e %**; com `rem` o construtor lança `SyntaxError`. O JS estava
sintaticamente perfeito, `node -c` aprovou, e no navegador a exceção **abortou todo o resto
do script** — o `hydrate()` nunca rodou (threads não carregavam) e os handlers seguintes não
foram registrados (expandir contexto parou de funcionar). Dois sintomas aparentemente
desconexos, uma linha de causa.

Duas regras que saíram disso:

1. **Todo bloco decorativo vai dentro de `try/catch`.** Scroll spy, sombra de barra, realce
   — nada disso pode derrubar diff, threads ou navegação. Se falhar, avisa no console e a
   página segue.
2. **Antes de publicar, revise as chamadas de API do browser por restrições de formato**,
   que o parser não conhece:

```bash
# unidades inválidas em APIs que só aceitam px/% (IntersectionObserver.rootMargin)
awk '/^<script>$/{f=1;next} /^<\/script>$/{f=0} f' <arquivo> | grep -n "rootMargin" 
```

Quando um recurso novo "não funciona" e **outro, sem relação, também para**, suspeite de
exceção no boot antes de procurar bug em cada um: um `throw` no meio do script mata tudo o
que vem depois dele.

## Como as peças se encaixam

| Peça | Papel |
|------|-------|
| `scripts/build-review-page.js` | `git diff` → parse de unified diff → injeta dados no template. Sem dependências |
| `templates/review-page.html` | CSS + motor JS (toolbar, 3 modos, busca, expand, rich diff, threads). Não editar por review |
| Esta skill | Escolhe o alvo, roda o gerador, adiciona categorias e intenção, e responde threads |

Dois blocos JSON no HTML, com donos distintos:

| Bloco | Escrito por | Conteúdo |
|-------|-------------|----------|
| `#review-data` | gerador | `files` (conteúdo completo, para expandir contexto) + `patches` (hunks) |
| `#agent-replies` | você, ao responder | respostas ligadas por `threadId` |

E `data/threads.json`, fora do HTML, escrito pela própria página.

O template recebe os dados por um único `<script type="application/json"
id="review-data">` — com `<` escapado como `<`, para que nada no código revisado possa
fechar a tag hospedeira.

**Mudança no template vale para todo review futuro.** Se uma feature de UI faltar, corrija o
template — não remende o HTML gerado de um review específico.
