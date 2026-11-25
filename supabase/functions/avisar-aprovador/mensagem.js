// ============================================================
//  Texto do e-mail "campanha nova esperando você" (C3, v2.9 — NÃO publicado).
//  Puro, sem Deno nem rede: testado em tests/aviso.test.mjs.
//  NUNCA põe os dados Swile (swile_*) no e-mail: o webhook manda a linha
//  inteira da tabela, mas aqui só entram código, empresa, fornecedores,
//  campanha, quem pediu e o custo.
// ============================================================

// Mesma conta de public/js/lib/regras.js → calc() (o teste confere).
export function custoTotal(c) {
  const inv = (+c.investimento_lynkz || 0) + (+c.investimento_industria || 0);
  const meta = +c.meta || 0, p = +c.rebate_pct || 0, teto = +c.rebate_teto || 0;
  let reb = meta > 0 && p > 0 ? meta * (p / 100) : 0;
  if (teto > 0 && reb > teto) reb = teto;
  const total = inv + reb;
  return { total, pctMeta: meta > 0 ? total / meta : null };
}

const brl = n => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(+n || 0);
const pct = n => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(n * 100) + '%';
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/**
 * @param {object} c       linha nova de public.campanhas (record do Database Webhook)
 * @param {string} appUrl  endereço do app, ex.: https://campanhas-lynkz.lucas-melonio.workers.dev
 * @returns {{ assunto: string, texto: string, html: string, link: string }}
 */
export function montarAviso(c, appUrl) {
  const { total, pctMeta } = custoTotal(c);
  const link = `${String(appUrl).replace(/\/+$/, '')}/#/campanhas/${encodeURIComponent(c.id)}`;
  const custo = `R$ ${brl(total)}${pctMeta == null ? '' : ` (${pct(pctMeta)} da meta)`}`;
  const linhas = [
    ['Código', c.codigo], ['Empresa', c.cliente], ['Fornecedores', c.laboratorio],
    ['Campanha', c.campanha], ['Enviada por', c.solicitante_nome], ['Custo total', custo],
  ].filter(([, v]) => v != null && v !== '');
  const assunto = `Campanha nova esperando você: ${c.cliente} · R$ ${brl(total)}`;
  const texto = [
    'Uma campanha nova chegou para aprovação.', '',
    ...linhas.map(([k, v]) => `${k}: ${v}`), '',
    `Abrir no app: ${link}`,
  ].join('\n');
  const html = `<p>Uma campanha nova chegou para aprovação.</p>
<table cellpadding="4" style="border-collapse:collapse">${linhas.map(([k, v]) => `<tr><td style="color:#555">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join('')}</table>
<p><a href="${esc(link)}">Abrir a campanha no app</a></p>`;
  return { assunto, texto, html, link };
}
