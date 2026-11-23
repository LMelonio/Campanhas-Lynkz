// ============================================================
//  COMPRAS NO QLIK — quanto o cliente comprou do laboratório no período
//  e quais notas fiscais compõem isso.
//  Quem fala com o Qlik é o Worker (/api/qlik/compras): a chave dele nunca
//  chega ao navegador. Aqui só pedimos e tratamos a resposta.
// ============================================================
import { sb } from '../lib/supabase.js';
import { normaliza } from '../lib/regras.js';
import { ErroApp } from './erros.js';

const C = window.CONFIG;
// Laboratório que não é fornecedor no Qlik: não há o que consultar.
const SEM_CONSULTA = ['recurso proprio'];

export const laboratorioConsultavel = lab => !!lab && !SEM_CONSULTA.includes(normaliza(lab));

// Como o laboratório aparece em "Nome Fantasia Fornecedor" no Qlik. O Qlik
// compara sem caixa e aceita * (qualquer trecho). Sem configuração em
// config.js (LABORATORIO_QLIK), usa a primeira palavra sem a parte acentuada:
// "Biogénesis Bagó Pet" → *Biog*, "Ouro Fino" → *Ouro*.
export function padraoFornecedor(lab) {
  const configurado = C.LABORATORIO_QLIK?.[lab];
  if (configurado) return configurado;
  const primeira = String(lab || '').trim().split(/\s+/)[0] || '';
  const ate = primeira.search(/[^A-Za-z0-9]/);
  return `*${ate > 0 ? primeira.slice(0, ate) : primeira}*`;
}

// Devolve { total, notas:[{numero, serie, data, valor}], fornecedores:[], marcas:[{nome, valor}], consultado_em }.
// "marca" (opcional) restringe total e notas a uma marca do laboratório; "marcas" lista todas as do período.
// Lança ErroApp com mensagem pronta para mostrar na tela.
export async function consultarCompras({ codigoCliente, laboratorio, marca = null, inicio, fim, sinal }) {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new ErroApp('Entre de novo no app para consultar o Qlik.');
  let resp;
  try {
    resp = await fetch('/api/qlik/compras', {
      method: 'POST', signal: sinal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ codigo_cliente: codigoCliente, fornecedor_padrao: padraoFornecedor(laboratorio), marca: marca || undefined, inicio, fim }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ErroApp('Sem conexão para consultar o Qlik. Você pode seguir sem as notas e anexá-las depois.');
  }
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ErroApp(corpo.erro || 'Não foi possível consultar o Qlik agora.');
  return corpo;
}
