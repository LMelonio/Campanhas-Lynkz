// Lê o arquivo .env da raiz do projeto (CHAVE=valor por linha) sem depender
// de pacote. Variáveis já definidas no ambiente (ex.: GitHub Actions) vencem.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function lerEnv(arquivo = join(RAIZ, '.env')) {
  const env = {};
  if (existsSync(arquivo)) {
    for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || linha.trim().startsWith('#')) continue;
      env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k in env || /^(QLIK|SUPABASE)_/.test(k))) };
}

export function exigirEnv(env, nomes) {
  const faltam = nomes.filter(n => !env[n]);
  if (faltam.length) {
    console.error(`Faltam no .env: ${faltam.join(', ')}.\nCopie .env.exemplo para .env e preencha.`);
    process.exit(2);
  }
}
