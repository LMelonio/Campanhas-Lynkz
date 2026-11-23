#!/usr/bin/env node
// ============================================================
//  SINCRONIZAR CLIENTES DO QLIK → EMPRESAS DO APP
//
//  Uso (na raiz do projeto, com o .env preenchido — ver .env.exemplo):
//    npm run qlik:simular      lê o Qlik e só mostra/gera o arquivo, sem gravar
//    npm run qlik:clientes     lê o Qlik e grava no Supabase
//    node scripts/sincronizar-clientes-qlik.mjs --arquivo clientes.xlsx
//        usa um Excel exportado do Qlik em vez da API (mesmos nomes de coluna)
//
//  O que acontece no banco (função importar_clientes_qlik, migração 07):
//  atualiza pelo código do cliente; empresa já cadastrada sem código é
//  vinculada pelo CNPJ ou pelo nome; o resto vira empresa nova. Nada é
//  apagado nem desativado. Pode rodar todo dia.
// ============================================================
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import XLSX from 'xlsx';
import { RAIZ, lerEnv, exigirEnv } from './lib/env.mjs';
import { chamarFuncao } from './lib/supabase-rpc.mjs';
import { lerClientesQlik, converterClientesQlik, camposDoEnv, MEDIDA_PADRAO } from './lib/qlik.mjs';
import { hojeCivil } from '../public/js/lib/regras.js';

const args = process.argv.slice(2);
const simular = args.includes('--simular');
const iArq = args.indexOf('--arquivo');
const arquivo = iArq >= 0 ? args[iArq + 1] : null;
const LOTE = 500;

const env = lerEnv();
const campos = camposDoEnv(env);
if (!campos.codigo || !campos.nome) { console.error('QLIK_CAMPO_CODIGO e QLIK_CAMPO_NOME são obrigatórios.'); process.exit(2); }

let brutas;
if (arquivo) {
  // Excel exportado do Qlik: as colunas têm os mesmos nomes dos campos.
  const wb = XLSX.read(readFileSync(arquivo));
  const regs = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
  const achar = nome => Object.keys(regs[0] || {}).find(h => h.trim().toLowerCase() === nome.toLowerCase());
  const mapa = Object.fromEntries(Object.entries(campos).filter(([, f]) => f).map(([k, f]) => [k, achar(f)]));
  if (!mapa.codigo || !mapa.nome) { console.error(`${arquivo}: não achei as colunas "${campos.codigo}" e "${campos.nome}".`); process.exit(2); }
  brutas = regs.map(r => ({ ...Object.fromEntries(Object.entries(mapa).filter(([, h]) => h).map(([k, h]) => [k, r[h]])), _medida: 0 }));
  console.log(`Lidas ${brutas.length} linhas de ${arquivo}.`);
} else {
  exigirEnv(env, ['QLIK_TENANT', 'QLIK_API_KEY', 'QLIK_APP_ID']);
  console.log(`Lendo clientes do Qlik (${env.QLIK_TENANT}, app ${env.QLIK_APP_ID})…`);
  brutas = await lerClientesQlik({
    tenant: env.QLIK_TENANT, apiKey: env.QLIK_API_KEY, appId: env.QLIK_APP_ID,
    campos, medida: env.QLIK_MEDIDA || MEDIDA_PADRAO,
    aoProgresso: (n, t) => process.stdout.write(`\r  ${n} de ${t} linhas`),
  });
  process.stdout.write('\n');
}

const clientes = converterClientesQlik(brutas);
const semDoc = clientes.filter(c => c.documento.length !== 14).length;
console.log(`Clientes únicos: ${clientes.length} (${semDoc} sem CNPJ — pessoa física ou em branco; entram pelo código).`);

if (simular) {
  const pasta = join(RAIZ, 'dados-privados');
  mkdirSync(pasta, { recursive: true });
  const saida = join(pasta, `clientes-qlik-${hojeCivil()}.json`);
  writeFileSync(saida, JSON.stringify(clientes, null, 2));
  console.log(`Simulação: nada foi gravado. Confira ${saida}`);
  console.log('Primeiros 5:', clientes.slice(0, 5));
  process.exit(0);
}

exigirEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
const soma = {};
for (let i = 0; i < clientes.length; i += LOTE) {
  const r = await chamarFuncao(env, 'importar_clientes_qlik', { p_linhas: clientes.slice(i, i + LOTE) });
  for (const [k, v] of Object.entries(r)) soma[k] = (soma[k] || 0) + v;
  process.stdout.write(`\r  gravados ${Math.min(i + LOTE, clientes.length)} de ${clientes.length}`);
}
process.stdout.write('\n');
console.log('Resultado:', soma);
