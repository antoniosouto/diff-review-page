#!/usr/bin/env node
/**
 * build-review-page.js — gera uma página de code review (HTML autocontido) a
 * partir de alterações git: working tree, staged, um commit, um range ou branch.
 *
 * Uso:
 *   node build-review-page.js [alvo] [opções]
 *
 * Alvos (escolha um; default: --all):
 *   --unstaged            mudanças não adicionadas ao index
 *   --staged              mudanças no index
 *   --all                 index + working tree (HEAD vs disco)
 *   --commit <sha>        um commit específico
 *   --range <a>..<b>      intervalo de commits
 *   --branch <base>       tudo que a branch atual tem além de <base>
 *   --untracked           inclui arquivos novos não rastreados (com --unstaged/--all)
 *
 * Opções:
 *   --out <arquivo>       saída (default: review-page.html no cwd)
 *   --title <texto>       título da página
 *   --repo <dir>          raiz do repo (default: cwd)
 *   --context <n>         linhas de contexto por hunk no diff (default: 3)
 *   --json                emite só o JSON de dados (para inspeção/depuração)
 *
 * Não tem dependências: só `git` no PATH e Node >= 14.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ===== CLI =====

function parseArgs(argv) {
  const o = {
    mode: null, sha: null, range: null, base: null, before: null, after: null,
    out: null, title: null, repo: process.cwd(),
    context: 3, untracked: false, json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--unstaged" || a === "--staged" || a === "--all") o.mode = a.slice(2);
    else if (a === "--commit") { o.mode = "commit"; o.sha = argv[++i]; }
    else if (a === "--range") { o.mode = "range"; o.range = argv[++i]; }
    else if (a === "--branch") { o.mode = "branch"; o.base = argv[++i]; }
    else if (a === "--no-index") { o.mode = "noindex"; o.before = argv[++i]; o.after = argv[++i]; }
    else if (a === "--untracked") o.untracked = true;
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--title") o.title = argv[++i];
    else if (a === "--repo") o.repo = argv[++i];
    else if (a === "--context") o.context = parseInt(argv[++i], 10) || 3;
    else if (a === "--json") o.json = true;
    else if (a === "--help" || a === "-h") { usage(); process.exit(0); }
    else { throw new Error(`argumento desconhecido: ${a}`); }
  }
  if (!o.mode) o.mode = "all";
  return o;
}

function usage() {
  process.stderr.write(fs.readFileSync(__filename, "utf-8").split("*/")[0].replace(/^\/\*\*?/, "") + "\n");
}

// ===== git =====

function git(repo, args) {
  // stderr em "pipe": erros esperados (arquivo ausente numa revisão) são
  // tratados por quem chama, não devem poluir o terminal do usuário.
  return execFileSync("git", args, {
    cwd: repo, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitOrNull(repo, args) {
  try { return git(repo, args); } catch { return null; }
}

/**
 * Como gitOrNull, mas preserva stdout quando o git sai com código != 0 por
 * DESIGN — `diff --no-index` devolve 1 sempre que encontra diferenças, que é
 * justamente o caso de sucesso aqui.
 */
function gitAllowExit1(repo, args) {
  try { return git(repo, args); }
  catch (err) { return err.stdout ? String(err.stdout) : null; }
}

function diffArgs(o) {
  const ctx = [`-U${o.context}`, "--no-color", "--no-ext-diff", "--find-renames"];
  switch (o.mode) {
    case "unstaged": return ["diff", ...ctx];
    case "staged":   return ["diff", "--cached", ...ctx];
    case "all":      return ["diff", "HEAD", ...ctx];
    case "commit":   return ["show", o.sha, "--format=", ...ctx];
    case "range":    return ["diff", o.range, ...ctx];
    case "branch":   return ["diff", `${o.base}...HEAD`, ...ctx];
    // Sem git: compara duas árvores no disco. `git diff --no-index` funciona
    // fora de repositório e é o único caminho para pasta não versionada.
    case "noindex":  return ["diff", "--no-index", ...ctx, o.before, o.after];
    default: throw new Error("alvo inválido");
  }
}

/** Conteúdo da versão "depois" — base para expandir contexto e ver arquivo inteiro. */
function afterContent(repo, o, file) {
  if (o.mode === "commit") return gitOrNull(repo, ["show", `${o.sha}:${file}`]);
  if (o.mode === "noindex") {
    try { return fs.readFileSync(path.join(o.after, file), "utf-8"); } catch { return null; }
  }

  if (o.mode === "branch") return gitOrNull(repo, ["show", `HEAD:${file}`]);

  if (o.mode === "range") {
    // "a..b" → a versão depois é `b`. Mas "a" sozinho faz o git comparar com o
    // WORKING TREE, e aí a versão depois é o arquivo no disco — buscá-la em `a`
    // falha justamente nos arquivos criados depois daquele commit.
    const parts = o.range.split("..");
    const right = parts.length > 1 ? parts[parts.length - 1] : "";
    if (right) return gitOrNull(repo, ["show", `${right}:${file}`]);
    try { return fs.readFileSync(path.join(repo, file), "utf-8"); } catch { return null; }
  }
  if (o.mode === "staged") return gitOrNull(repo, ["show", `:${file}`]);
  // unstaged / all → o arquivo no disco
  try { return fs.readFileSync(path.join(repo, file), "utf-8"); } catch { return null; }
}

// ===== parse do unified diff =====

/**
 * Converte unified diff em { path, status, rows } por arquivo.
 * rows usa o mesmo contrato do template:
 *   { t:'c'|'a', ln, to }  → referencia linhas REAIS do arquivo "depois"
 *   { t:'d', lines:[...] } → texto literal removido (não existe no "depois")
 */
function parseDiff(text, stripPrefix) {
  // No modo --no-index os paths vêm com o diretório inteiro ("b/tmp/x/arq.md");
  // normaliza para o caminho relativo à árvore "depois".
  const rel = (p) => {
    if (!stripPrefix) return p;
    const abs = p.startsWith("/") ? p : "/" + p;
    const base = stripPrefix.endsWith("/") ? stripPrefix : stripPrefix + "/";
    return abs.startsWith(base) ? abs.slice(base.length) : p;
  };
  const files = [];
  let cur = null, hunk = null;

  const flushHunk = () => { if (cur && hunk && hunk.rows.length) cur.hunks.push(hunk); hunk = null; };
  const flushFile = () => { flushHunk(); if (cur) files.push(cur); cur = null; };

  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flushFile();
      const m = line.match(/ b\/(.+)$/);
      cur = { path: m ? rel(m[1]) : "(desconhecido)", status: "modified", hunks: [], binary: false };
      continue;
    }
    if (!cur) continue;

    if (line.startsWith("new file mode")) { cur.status = "added"; continue; }
    if (line.startsWith("deleted file mode")) { cur.status = "deleted"; continue; }
    if (line.startsWith("rename from ")) { cur.status = "renamed"; cur.from = rel(line.slice(12)); continue; }
    if (line.startsWith("rename to ")) { cur.path = rel(line.slice(10)); continue; }
    if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) { cur.binary = true; continue; }
    if (/^(index |--- |\+\+\+ |old mode |new mode |similarity index |dissimilarity )/.test(line)) continue;

    const hh = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hh) {
      flushHunk();
      hunk = { newLine: parseInt(hh[1], 10), rows: [] };
      continue;
    }
    if (!hunk) continue;

    const kind = line[0];
    const body = line.slice(1);

    if (kind === "\\") continue;              // "\ No newline at end of file"

    if (kind === "-") {
      const last = hunk.rows[hunk.rows.length - 1];
      if (last && last.t === "d") last.lines.push(body);
      else hunk.rows.push({ t: "d", lines: [body] });
      continue;
    }
    if (kind === "+" || kind === " ") {
      const t = kind === "+" ? "a" : "c";
      const ln = hunk.newLine++;
      const last = hunk.rows[hunk.rows.length - 1];
      if (last && last.t === t && (last.to || last.ln) === ln - 1) last.to = ln;
      else hunk.rows.push({ t, ln });
      continue;
    }
  }
  flushFile();
  return files;
}

/** Contagem +/- por arquivo, para os badges. */
function countChanges(hunks) {
  let add = 0, del = 0;
  for (const h of hunks) {
    for (const r of h.rows) {
      if (r.t === "a") add += (r.to || r.ln) - r.ln + 1;
      else if (r.t === "d") del += r.lines.length;
    }
  }
  return { add, del };
}

// ===== HTML =====

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Chave estável e segura para id/atributo, derivada do path. */
function keyFor(p, used) {
  let k = p.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  if (k.length > 60) k = k.slice(-60).replace(/^-+/, "");
  let base = k, n = 2;
  while (used.has(k)) k = `${base}-${n++}`;
  used.add(k);
  return k;
}

const BADGE = {
  added:    { cls: "new",          label: "novo" },
  deleted:  { cls: "removed-file", label: "removido" },
  renamed:  { cls: "modified",     label: "renomeado" },
  modified: { cls: "modified",     label: "modificado" },
};

function cardHtml(f) {
  const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
  const base = f.path.slice(dir.length);
  const badge = BADGE[f.status] || BADGE.modified;
  const stats = `<span class="linecount" title="linhas adicionadas / removidas">` +
                `<span class="up">+${f.counts.add}</span><span class="down">−${f.counts.del}</span></span>`;

  // Arquivo sem conteúdo "depois" (removido/binário) não tem diff navegável.
  if (!f.hasAfter || f.binary || !f.hunks.length) {
    const why = f.binary ? "Arquivo binário — sem diff textual."
      : f.status === "deleted" ? "Arquivo removido; não há conteúdo posterior para exibir."
      : "Sem alterações textuais detectadas.";
    return `        <article class="patch" id="file-${f.key}" data-path="${esc(f.path)}">
          <div class="patch-head">
            <div class="patch-path"><span class="dir">${esc(dir)}</span>${esc(base)}</div>
            <div class="patch-head-right">${stats}<span class="badge ${badge.cls}">${badge.label}</span></div>
          </div>
          <p class="patch-why"><b>Por quê:</b> ${esc(why)}</p>
          <div class="file-removed-block">${esc(f.path)} — sem conteúdo para diff.</div>
          <div class="discussion">${DISCUSSION}</div>
        </article>`;
  }

  const rename = f.from ? `<p class="diff-note">Renomeado de <code>${esc(f.from)}</code>.</p>` : "";

  return `        <article class="patch" id="file-${f.key}" data-file-key="${f.key}" data-path="${esc(f.path)}">
          <div class="patch-head">
            <div class="patch-path"><span class="dir">${esc(dir)}</span>${esc(base)}</div>
            <div class="patch-head-right">
              <div class="filetoggle" role="group" aria-label="Diff ou arquivo inteiro">
                <button type="button" class="ft-btn active" data-ft="diff">Diff</button>
                <button type="button" class="ft-btn" data-ft="full">Arquivo inteiro</button>
              </div>
              ${stats}<span class="badge ${badge.cls}">${badge.label}</span>
            </div>
          </div>
          <p class="patch-why"><b>Por quê:</b> <span class="why-todo">descreva aqui a intenção da mudança</span></p>
          <div class="diffbody" data-mode="inline"></div>
${rename ? "          " + rename + "\n" : ""}          <div class="discussion">${DISCUSSION}</div>
        </article>`;
}

const DISCUSSION = `
            <div class="discussion-head"><h4>Discussão</h4><button type="button" class="new-thread-btn">+ Novo comentário</button></div>
            <div class="thread-list"></div>
            <div class="composer">
              <div class="composer-target">Novo comentário</div>
              <textarea class="composer-text" placeholder="Escreva o comentário… (pode colar imagem com Ctrl+V)"></textarea>
              <div class="composer-shots"></div>
              <div class="composer-actions"><span class="paste-hint">Ctrl+V cola imagem</span><button type="button" class="ghost composer-cancel">Cancelar</button><button type="button" class="primary composer-submit">Comentar</button></div>
            </div>
          `;

function navHtml(files) {
  return `
        <div class="filenav-group">
          <h3>Arquivos (${files.length})</h3>
          <ul>
${files.map((f) => `            <li><a href="#file-${f.key}">${esc(f.path.split("/").pop())}</a></li>`).join("\n")}
          </ul>
        </div>`;
}

function statsHtml(files, totals) {
  return `
        <div class="stat"><b>${files.length}</b><span>${files.length === 1 ? "arquivo" : "arquivos"}</span></div>
        <div class="stat added"><b>+${totals.add}</b><span>linhas</span></div>
        <div class="stat removed"><b>−${totals.del}</b><span>linhas</span></div>`;
}

function describeTarget(o) {
  switch (o.mode) {
    case "unstaged": return "working tree (não adicionado ao index)";
    case "staged":   return "index (staged)";
    case "all":      return "HEAD vs working tree (staged + não-staged)";
    case "commit":   return `commit ${o.sha}`;
    case "range":    return `range ${o.range}`;
    case "branch":   return `branch atual vs ${o.base}`;
    case "noindex":  return `${path.basename(o.before)}/ → ${path.basename(o.after)}/ (sem git)`;
    default:         return o.mode;
  }
}

// ===== main =====

function main() {
  const o = parseArgs(process.argv.slice(2));

  let repoRoot, raw;

  if (o.mode === "noindex") {
    for (const d of [o.before, o.after]) {
      if (!d || !fs.existsSync(d)) throw new Error(`diretório inexistente: ${d}`);
    }
    o.before = path.resolve(o.before);
    o.after = path.resolve(o.after);
    repoRoot = o.after;
    raw = gitAllowExit1(process.cwd(), diffArgs(o)) || "";   // exit 1 = achou diferenças
  } else {
    repoRoot = (gitOrNull(o.repo, ["rev-parse", "--show-toplevel"]) || "").trim();
    if (!repoRoot) {
      process.stderr.write(`erro: ${o.repo} não está dentro de um repositório git\n`);
      process.stderr.write(`       para comparar pastas sem git use: --no-index <antes> <depois>\n`);
      process.exit(1);
    }
    raw = git(repoRoot, diffArgs(o));
  }

  // Arquivos novos não rastreados: git diff não os vê; gera um diff sintético.
  if (o.untracked && (o.mode === "unstaged" || o.mode === "all")) {
    const list = (gitOrNull(repoRoot, ["ls-files", "--others", "--exclude-standard"]) || "")
      .split("\n").filter(Boolean);
    for (const f of list) {
      const extra = gitAllowExit1(repoRoot, ["diff", "--no-index", "--no-color", `-U${o.context}`, "/dev/null", f]);
      if (extra && extra.trim()) raw += "\n" + extra;
    }
  }

  const parsed = parseDiff(raw, o.mode === "noindex" ? o.after : null);
  if (!parsed.length) {
    process.stderr.write(`nenhuma alteração encontrada em: ${describeTarget(o)}\n`);
    process.exit(2);
  }

  const used = new Set();
  const filesData = {};
  const patches = {};
  const totals = { add: 0, del: 0 };

  for (const f of parsed) {
    f.key = keyFor(f.path, used);
    f.counts = countChanges(f.hunks);
    totals.add += f.counts.add;
    totals.del += f.counts.del;

    const after = f.status === "deleted" || f.binary ? null : afterContent(repoRoot, o, f.path);
    f.hasAfter = after != null;
    if (f.hasAfter) {
      filesData[f.key] = after.split("\n");
      // remove a linha vazia final que split() produz em arquivos terminados em \n
      if (filesData[f.key][filesData[f.key].length - 1] === "") filesData[f.key].pop();
      patches[f.key] = f.hunks.map((h) => ({ rows: h.rows }));
    }
  }

  const data = { files: filesData, patches, meta: { target: describeTarget(o), repo: repoRoot } };

  if (o.json) {
    process.stdout.write(JSON.stringify(data, null, 2));
    return;
  }

  const tplPath = path.join(__dirname, "..", "templates", "review-page.html");
  let html = fs.readFileSync(tplPath, "utf-8");

  const repoName = path.basename(repoRoot);
  const title = o.title || `Review · ${repoName}`;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

  // `<` escapado para que nada no conteúdo possa fechar o <script> hospedeiro.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  const replacements = {
    __TITLE__: esc(title),
    __EYEBROW__: esc(`${repoName} · ${describeTarget(o)} · ${stamp}`),
    __HEADING__: esc(title),
    // A lede diz o que NÃO é óbvio. Listar as features é redundante — os
    // botões estão logo abaixo; o passo que ninguém adivinha é o handoff.
    __LEDE__: `${parsed.length} ${parsed.length === 1 ? "arquivo alterado" : "arquivos alterados"} em <code>${esc(describeTarget(o))}</code>. ` +
              `Comente nas linhas e, ao terminar, copie as threads em <b>⧉</b> e cole na sessão do Claude Code — é assim que os comentários chegam até mim.`,
    __STATS__: statsHtml(parsed, totals),
    __FILENAV__: navHtml(parsed),
    __CARDS__: `      <section class="category">
        <div class="category-head">
          <span class="tag qa">${esc(describeTarget(o))}</span>
          <h2>Alterações</h2>
        </div>
        <p class="category-note">Agrupe por tema e preencha o "Por quê" de cada arquivo — é o que transforma um diff em revisão.</p>

${parsed.map(cardHtml).join("\n\n")}
      </section>`,
    __FOOTER__: `Gerado por <code>diff-review-page</code> a partir de <code>${esc(describeTarget(o))}</code> em ${esc(stamp)}. ` +
                `Repositório: <code>${esc(repoRoot)}</code>.` +
                `<p class="sync-note">Comentários e threads vivem nesta aba do navegador. Para preservá-los, ` +
                `peça ao Claude Code para republicar a página com as respostas.</p>`,
    __REVIEW_DATA__: json,
    // Vazios na geração: quem preenche é o Claude Code ao responder as threads.
    // SEED_THREADS é o eco das threads recebidas — sem ele, republicar a página
    // apaga os comentários (a html form não preserva data/threads.json).
    __AGENT_REPLIES__: '{"v":1,"replies":[]}',
    __SEED_THREADS__: '{"v":1,"threads":[]}',
  };

  for (const [k, v] of Object.entries(replacements)) html = html.split(k).join(v);

  const leftovers = html.match(/__[A-Z_]+__/g);
  if (leftovers) {
    process.stderr.write(`aviso: placeholder(s) não substituído(s): ${[...new Set(leftovers)].join(", ")}\n`);
  }

  const out = o.out || path.join(process.cwd(), "review-page.html");
  fs.writeFileSync(out, html, "utf-8");
  process.stderr.write(
    `página gerada: ${out}\n` +
    `  alvo: ${describeTarget(o)}\n` +
    `  arquivos: ${parsed.length} (+${totals.add} −${totals.del})\n` +
    `  sem diff navegável: ${parsed.filter((f) => !f.hasAfter || f.binary || !f.hunks.length).length}\n`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`erro: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { parseDiff, countChanges };
