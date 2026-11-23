#!/usr/bin/env node
// ============================================================
//  IMPORTAR PLANILHAS ANTIGAS DE CAMPANHAS
//
//  Uso:
//    node scripts/importar-planilhas.mjs "Campanhas Setembro.xlsx" "Campanhas Outubro 2026.xlsx"
//    node scripts/importar-planilhas.mjs arquivo.xlsx:2026-09     (mês de referência explícito)
//    ... --enviar     grava direto no Supabase (precisa do .env com a service_role)
//
//  Sem --enviar, só gera em dados-privados/ (pasta fora do Git):
//    historico-AAAA-MM-DD.sql   → cole no SQL Editor do Supabase e rode
//    historico-AAAA-MM-DD.json  → as mesmas linhas, para conferir
//  e mostra o relatório: quantas campanhas, empresas, balconistas, avisos e erros.
//
//  Rodar de novo com os mesmos arquivos não duplica (o código de cada
//  campanha é fixo: H + AAMM + nº da linha).
// ============================================================
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import vm from 'node:vm';
import XLSX from 'xlsx';
import { RAIZ, lerEnv, exigirEnv } from './lib/env.mjs';
import { chamarFuncao } from './lib/supabase-rpc.mjs';
import { converterPlanilha, juntarPlanilhas, nomeComparavel } from './lib/planilhas.mjs';
import { hojeCivil } from '../public/js/lib/regras.js';

const MESES = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function lerConfig() {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(join(RAIZ, 'public', 'config.js'), 'utf8'), ctx);
  return ctx.window.CONFIG;
}

// "Campanhas Setembro.xlsx" → "2026-09" (ano do nome do arquivo ou o atual).
function mesDoArquivo(nome) {
  const n = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const i = MESES.findIndex(m => n.includes(m));
  if (i < 0) return null;
  const ano = (n.match(/20\d{2}/) || [String(new Date().getFullYear())])[0];
  return `${ano}-${String(i + 1).padStart(2, '0')}`;
}

const args = process.argv.slice(2);
const enviar = args.includes('--enviar');
const arquivos = args.filter(a => !a.startsWith('--'));
if (!arquivos.length) {
  console.error('Informe as planilhas. Ex.: node scripts/importar-planilhas.mjs "Campanhas Setembro.xlsx"');
  process.exit(2);
}

const config = lerConfig();
const dePara = Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(RAIZ, 'scripts', 'de-para-empresas.json'), 'utf8')))
  .filter(([k]) => !k.startsWith('_')));
const hoje = hojeCivil();

const resultados = arquivos.map(arg => {
  const [caminho, mesInformado] = arg.match(/^(.*?)(?::(\d{4}-\d{2}))?$/).slice(1);
  const mes = mesInformado || mesDoArquivo(basename(caminho));
  if (!mes) { console.error(`${caminho}: não sei o mês. Use ${caminho}:AAAA-MM`); process.exit(2); }
  const wb = XLSX.read(readFileSync(caminho), { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const registros = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  return converterPlanilha(registros, { mes, config, dePara, hoje, arquivo: basename(caminho) });
});
const { linhas, avisos, erros } = juntarPlanilhas(resultados);

// ---------- relatório ----------
const empresas = new Set(linhas.map(l => nomeComparavel(l.empresa)));
const balconistas = new Set(linhas.filter(l => l.recebedor).map(l => nomeComparavel(l.empresa) + '|' + l.recebedor.cpf));
const total = linhas.reduce((t, l) => t + l.valor, 0);
console.log(`\nCampanhas prontas: ${linhas.length} · Empresas: ${empresas.size} · Balconistas: ${balconistas.size} · Valor: R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
if (avisos.length) console.log(`\nAvisos (${avisos.length}) — entram, mas confira:\n- ` + avisos.join('\n- '));
if (erros.length) console.log(`\nErros (${erros.length}) — estas linhas NÃO entram:\n- ` + erros.join('\n- '));

if (!linhas.length) process.exit(erros.length ? 1 : 0);

if (enviar) {
  const env = lerEnv();
  exigirEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  const r = await chamarFuncao(env, 'importar_historico_planilha', { p_linhas: linhas });
  console.log('\nGravado no Supabase:', r);
} else {
  const pasta = join(RAIZ, 'dados-privados');
  mkdirSync(pasta, { recursive: true });
  const base = join(pasta, `historico-${hoje}`);
  writeFileSync(base + '.json', JSON.stringify(linhas, null, 2));
  writeFileSync(base + '.sql', [
    '-- Histórico das planilhas antigas — gerado por scripts/importar-planilhas.mjs',
    `-- ${linhas.length} campanhas de: ${arquivos.map(a => basename(a)).join(', ')}`,
    '-- Tem CPF e dados pessoais: não envie por e-mail nem suba no GitHub.',
    '-- Cole no SQL Editor do Supabase e clique em Run. Rodar de novo não duplica.',
    `select public.importar_historico_planilha($json$${JSON.stringify(linhas)}$json$::jsonb);`,
    '',
  ].join('\n'));
  console.log(`\nArquivos gerados (fora do Git):\n  ${base}.sql  ← cole no SQL Editor do Supabase\n  ${base}.json`);
}
