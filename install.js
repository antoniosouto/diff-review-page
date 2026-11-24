#!/usr/bin/env node
/**
 * install.js — instalador da skill `diff-review-page`.
 *
 * Um único script para Linux, macOS e Windows: Node já é requisito da skill
 * (o gerador é Node), então dois instaladores em shell diferentes só teriam
 * duas chances de envelhecer.
 *
 * Uso:
 *   node install.js                 # interativo
 *   node install.js --user          # escopo de usuário, sem perguntar
 *   node install.js --project <dir> # escopo de projeto
 *   node install.js --dest <dir>    # destino explícito (o diretório da skill)
 *   node install.js --check         # só diagnostica, não instala
 *   node install.js --force         # sobrescreve sem perguntar
 *   node install.js --version       # versão do pacote e das instalações
 *
 * ONDE O CLAUDE CODE ENCONTRA SKILLS
 *   usuário : <home>/.claude/skills/<skill>/       → vale em todo projeto
 *   projeto : <projeto>/.claude/skills/<skill>/    → vale só naquele projeto
 * Qualquer outro caminho NÃO é varrido pelo harness: a skill fica no disco e
 * nunca é descoberta. Instale fora desses dois lugares apenas para montar um
 * pacote que será copiado depois.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { execFileSync } = require("child_process");

const SKILL = "diff-review-page";
const SRC = __dirname;
const PARTS = ["SKILL.md", "scripts", "templates"];   // o que compõe a skill

// ===== util =====

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { b: "\x1b[1m", d: "\x1b[2m", r: "\x1b[0m", g: "\x1b[32m", y: "\x1b[33m", e: "\x1b[31m", c: "\x1b[36m" }
  : { b: "", d: "", r: "", g: "", y: "", e: "", c: "" };

const say = (s = "") => process.stdout.write(s + "\n");
const ok = (s) => say(`  ${C.g}✓${C.r} ${s}`);
const warn = (s) => say(`  ${C.y}!${C.r} ${s}`);
const bad = (s) => say(`  ${C.e}✗${C.r} ${s}`);

function parseArgs(argv) {
  const o = { mode: null, dir: null, dest: null, force: false, check: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--user") o.mode = "user";
    else if (a === "--project") { o.mode = "project"; o.dir = argv[++i]; }
    else if (a === "--dest") { o.mode = "dest"; o.dest = argv[++i]; }
    else if (a === "--force") o.force = true;
    else if (a === "--check") o.check = true;
    else if (a === "--version" || a === "-v") o.version = true;
    else if (a === "--help" || a === "-h") { usage(); process.exit(0); }
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  return o;
}

function usage() {
  say(fs.readFileSync(__filename, "utf-8").split("*/")[0].replace(/^\/\*\*?/, ""));
}

function copyTree(from, to) {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from)) copyTree(path.join(from, e), path.join(to, e));
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

function ask(rl, q, def) {
  return new Promise((res) => {
    rl.question(`${q}${def ? ` ${C.d}[${def}]${C.r}` : ""} `, (a) => res((a || "").trim() || def || ""));
  });
}

/**
 * Versão vem do frontmatter da SKILL.md — fonte única. Manter o número também
 * aqui garantiria que um dos dois ficasse errado.
 */
function skillVersion(dir) {
  try {
    const md = fs.readFileSync(path.join(dir, "SKILL.md"), "utf-8");
    const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return null;
    const v = m[1].match(/^\s*version:\s*([\w.+-]+)\s*$/m);
    return v ? v[1] : null;
  } catch { return null; }
}

function showVersion() {
  const mine = skillVersion(SRC) || "desconhecida";
  say(`\n${C.b}${SKILL}${C.r} ${mine}  ${C.d}(pacote em ${SRC})${C.r}`);

  // Compara com o que está instalado nos lugares que o harness realmente varre.
  const spots = [
    { label: "usuário", dir: path.join(userSkillsDir(), SKILL) },
    { label: `projeto (${path.basename(process.cwd())})`, dir: path.join(process.cwd(), ".claude", "skills", SKILL) },
  ];

  say(`\n${C.b}Instalações encontradas${C.r}`);
  let any = false;
  for (const s of spots) {
    if (path.resolve(s.dir) === path.resolve(SRC)) {
      say(`  ${C.g}•${C.r} ${s.label}: ${mine} ${C.d}(é este próprio pacote)${C.r}`);
      any = true;
      continue;
    }
    if (!fs.existsSync(s.dir)) continue;
    any = true;
    const v = skillVersion(s.dir) || "desconhecida";
    const mark = v === mine ? `${C.g}=${C.r}` : `${C.y}≠${C.r}`;
    say(`  ${mark} ${s.label}: ${v}${v === mine ? "" : `  ${C.y}difere do pacote${C.r}`}`);
    say(`    ${C.d}${s.dir}${C.r}`);
  }
  if (!any) say(`  ${C.d}nenhuma — rode sem argumentos para instalar${C.r}`);
  say("");
}

// ===== diagnóstico =====

function diagnose() {
  say(`\n${C.b}Ambiente${C.r}`);
  const plat = { linux: "Linux", darwin: "macOS", win32: "Windows" }[process.platform] || process.platform;
  ok(`sistema: ${plat} (${process.arch})`);

  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major >= 14) ok(`Node ${process.versions.node}`);
  else { bad(`Node ${process.versions.node} — a skill precisa de 14 ou mais novo`); return false; }

  try {
    const v = execFileSync("git", ["--version"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    ok(v);
  } catch {
    bad("git não encontrado no PATH — o gerador de diff depende dele");
    return false;
  }

  const missing = PARTS.filter((p) => !fs.existsSync(path.join(SRC, p)));
  if (missing.length) { bad(`pacote incompleto, falta: ${missing.join(", ")}`); return false; }
  ok(`pacote completo (${PARTS.join(", ")})`);
  return true;
}

// ===== destinos =====

function userSkillsDir() {
  // O harness usa <home>/.claude em todas as plataformas; no Windows a home
  // vem de USERPROFILE, que é o que os.homedir() já resolve.
  return path.join(os.homedir(), ".claude", "skills");
}

function describeTargets() {
  const u = path.join(userSkillsDir(), SKILL);
  say(`\n${C.b}Onde instalar${C.r}`);
  say(`  ${C.c}1${C.r}) Usuário  ${C.d}${u}${C.r}`);
  say(`     vale em TODO projeto desta máquina. Recomendado para esta skill.`);
  say(`  ${C.c}2${C.r}) Projeto  ${C.d}<projeto>/.claude/skills/${SKILL}${C.r}`);
  say(`     vale só naquele projeto; dá para versionar junto do repo e o time inteiro usar.`);
  say(`  ${C.c}3${C.r}) Outro caminho`);
  say(`     ${C.y}o harness NÃO varre caminhos arbitrários${C.r} — a skill não seria descoberta.`);
  say(`     Serve apenas para montar um pacote a ser copiado depois.`);
}

// ===== instalação =====

function install(dest, force) {
  const exists = fs.existsSync(dest);
  if (exists && !force) return { needsConfirm: true, dest };

  if (exists) {
    // Substitui só as partes da skill; não mexe em nada que o usuário tenha
    // deixado no diretório (por exemplo um review gerado ali).
    for (const p of PARTS) {
      const t = path.join(dest, p);
      if (fs.existsSync(t)) fs.rmSync(t, { recursive: true, force: true });
    }
  }

  fs.mkdirSync(dest, { recursive: true });
  for (const p of PARTS) copyTree(path.join(SRC, p), path.join(dest, p));
  copyTree(path.join(SRC, "install.js"), path.join(dest, "install.js"));
  return { installed: true, dest };
}

function verify(dest) {
  say(`\n${C.b}Verificação${C.r}`);
  let good = true;

  for (const p of PARTS) {
    if (fs.existsSync(path.join(dest, p))) ok(p);
    else { bad(`${p} não chegou ao destino`); good = false; }
  }

  const gen = path.join(dest, "scripts", "build-review-page.js");
  try {
    execFileSync(process.execPath, ["--check", gen], { stdio: ["ignore", "pipe", "pipe"] });
    ok("gerador passa na checagem de sintaxe");
  } catch {
    bad("gerador não passa em node --check"); good = false;
  }

  const tpl = path.join(dest, "templates", "review-page.html");
  if (fs.existsSync(tpl)) {
    const html = fs.readFileSync(tpl, "utf-8");
    const holes = html.match(/__[A-Z_]+__/g) || [];
    const uniq = [...new Set(holes)];
    if (uniq.length >= 8) ok(`template com ${uniq.length} pontos de injeção`);
    else { warn(`template tem só ${uniq.length} pontos de injeção — parece truncado`); good = false; }
  }

  return good;
}

// ===== main =====

async function main() {
  const o = parseArgs(process.argv.slice(2));

  if (o.version) { showVersion(); return; }

  const pkgVersion = skillVersion(SRC);
  say(`\n${C.b}Instalador — skill ${SKILL}${C.r}${pkgVersion ? ` ${pkgVersion}` : ""}`);
  say(`${C.d}origem: ${SRC}${C.r}`);

  if (!diagnose()) {
    say(`\n${C.e}Ambiente não atende aos requisitos. Nada foi instalado.${C.r}\n`);
    process.exit(1);
  }
  if (o.check) { say(`\n${C.g}Diagnóstico concluído (--check: nada foi instalado).${C.r}\n`); return; }

  let dest = null;

  if (o.mode === "user") dest = path.join(userSkillsDir(), SKILL);
  else if (o.mode === "project") dest = path.join(path.resolve(o.dir), ".claude", "skills", SKILL);
  else if (o.mode === "dest") dest = path.resolve(o.dest);

  // Só abre readline se há terminal de verdade. Sem isto, rodar com stdin
  // fechado (CI, pipe) pendura uma pergunta que ninguém pode responder.
  const interactive = Boolean(process.stdin.isTTY);
  const rl = interactive && (!dest || !o.force)
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;

  try {
    if (!dest) {
      if (!process.stdin.isTTY) {
        say(`\n${C.e}Sem terminal interativo. Use --user, --project <dir> ou --dest <dir>.${C.r}\n`);
        process.exit(1);
      }
      describeTargets();
      const choice = await ask(rl, `\nEscolha ${C.c}1${C.r}, ${C.c}2${C.r} ou ${C.c}3${C.r}:`, "1");

      if (choice === "1") dest = path.join(userSkillsDir(), SKILL);
      else if (choice === "2") {
        const dir = await ask(rl, "Caminho do projeto:", process.cwd());
        const root = path.resolve(dir);
        if (!fs.existsSync(root)) { say(`\n${C.e}Diretório não existe: ${root}${C.r}\n`); process.exit(1); }
        dest = path.join(root, ".claude", "skills", SKILL);
      } else if (choice === "3") {
        const dir = await ask(rl, "Caminho completo do diretório da skill:", "");
        if (!dir) { say(`\n${C.e}Nenhum caminho informado.${C.r}\n`); process.exit(1); }
        dest = path.resolve(dir);
        warn("fora dos escopos conhecidos: o Claude Code não vai descobrir a skill aqui.");
        const go = await ask(rl, "Continuar mesmo assim? (s/N)", "N");
        if (!/^s/i.test(go)) { say("\nCancelado.\n"); process.exit(0); }
      } else { say(`\n${C.e}Opção inválida: ${choice}${C.r}\n`); process.exit(1); }
    }

    if (path.resolve(dest) === path.resolve(SRC)) {
      say(`\n${C.y}Origem e destino são o mesmo diretório — nada a copiar.${C.r}`);
      verify(dest);
      say("");
      return;
    }

    say(`\n${C.b}Destino${C.r}\n  ${dest}`);

    let res = install(dest, o.force);
    if (res.needsConfirm) {
      if (!rl) { say(`\n${C.e}Já existe uma skill em ${dest}. Use --force para substituir.${C.r}\n`); process.exit(1); }
      warn("já existe uma instalação aqui.");
      say(`  ${C.d}SKILL.md, scripts/ e templates/ serão substituídos; outros arquivos ficam.${C.r}`);
      const go = await ask(rl, "Substituir? (s/N)", "N");
      if (!/^s/i.test(go)) { say("\nCancelado.\n"); process.exit(0); }
      res = install(dest, true);
    }

    if (!verify(dest)) {
      say(`\n${C.e}Instalação incompleta — verifique os erros acima.${C.r}\n`);
      process.exit(1);
    }

    const inUserScope = dest.startsWith(userSkillsDir());
    const inProjectScope = /\.claude[\\/]skills[\\/]/.test(dest) && !inUserScope;

    say(`\n${C.g}Instalada em${C.r} ${dest}`);
    say(`\n${C.b}Como usar${C.r}`);
    if (inUserScope || inProjectScope) {
      say(`  Reinicie a sessão do Claude Code e peça, por exemplo:`);
      say(`    ${C.c}"revisa as alterações que ainda não commitei"${C.r}`);
      say(`  ou invoque direto: ${C.c}/${SKILL}${C.r}`);
      if (inProjectScope) say(`  ${C.d}Escopo de projeto: vale apenas dentro deste repositório.${C.r}`);
    } else {
      warn("caminho fora dos escopos conhecidos — copie este diretório para");
      say(`     ${C.d}${path.join(userSkillsDir(), SKILL)}${C.r} (ou para <projeto>/.claude/skills/) para ativá-la.`);
    }
    say("");
  } finally {
    if (rl) rl.close();
  }
}

main().catch((e) => { say(`\n${C.e}erro: ${e.message}${C.r}\n`); process.exit(1); });
