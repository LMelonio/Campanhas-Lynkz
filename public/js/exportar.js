// Excel: colunas como [título, valor, formato]; a letra de cada coluna é calculada. SheetJS carrega só ao exportar.
import { calc, dias, dataExcel, maskCPF, maskCNPJ, maskTelefone, colunaExcel, hojeCivil, partilha, brl, listaMarcas } from './lib/regras.js';
import { ErroApp } from './dados/erros.js';

// SheetJS no próprio site (public/vendor/), carregado só quando alguém baixa o Excel.
const SHEETJS = new URL('../vendor/xlsx-0.20.3.min.js', import.meta.url).href;
const FORMATOS = { data: 'dd/mm/yyyy', moeda: '"R$" #,##0.00', pct: '0.0%' };

// cad = módulo de cadastros (para CNPJ e balconista).
function colunas(cad) {
  const k = c => (c._k ??= calc(c));
  const empresa = c => (c.empresa_id ? cad.empresa(c.empresa_id) : null);
  const balc = c => (c.balconista_id ? cad.balconista(c.balconista_id) : null);
  return [
    ['ID', c => c.codigo],
    ['Data Solicitação', c => dataExcel(c.criado_em), 'data'],
    ['Solicitante', c => c.solicitante_nome || ''],
    ['Cliente', c => c.cliente],
    ['Código do Cliente (Qlik)', c => empresa(c)?.codigo_cliente || ''],
    ['CNPJ do Cliente', c => (empresa(c)?.cnpj ? maskCNPJ(empresa(c).cnpj) : '')],
    ['Cidade', c => empresa(c)?.cidade || ''],
    ['Vendedor', c => empresa(c)?.vendedor || ''],
    ['Fornecedores', c => c.laboratorio],
    ['Nome da Campanha', c => c.campanha],
    ['Tipo de Campanha', c => c.tipo || ''],
    ['Mecânica / Descrição', c => c.mecanica || ''],
    ['Investimento LYNKZ (R$)', c => k(c).invL, 'moeda'],
    ['Investimento Indústria (R$)', c => k(c).invI, 'moeda'],
    ['Forma de Pagamento', c => c.forma_pagamento || ''],
    ['Data Início', c => dataExcel(c.data_inicio), 'data'],
    ['Data Fim', c => dataExcel(c.data_fim), 'data'],
    ['Duração (dias)', c => dias(c.data_inicio, c.data_fim) || ''],
    ['Tipo de Meta', c => c.tipo_meta || ''],
    ['Meta do Cliente (R$)', c => +c.meta || 0, 'moeda'],
    // "Ouro Fino: meta R$ 20.000,00 · indústria R$ 1.000,00 · rebate R$ 400,00 | Avert: …"
    ['Divisão por Fornecedor', c => (partilha(c) || []).map(p =>
      `${p.nome}: meta R$ ${brl(p.meta)} · indústria R$ ${brl(p.investimento_industria)}${+c.rebate_pct > 0 ? ` · rebate R$ ${brl(p.rebate)}` : ''}`).join(' | ')],
    ['Tem Rebate', c => (k(c).reb > 0 ? 'Sim' : 'Não')],
    ['% Rebate', c => (+c.rebate_pct ? +c.rebate_pct / 100 : ''), 'pct'],
    ['Base do Rebate', c => c.rebate_base || ''],
    ['Gatilho do Rebate', c => c.rebate_gatilho || ''],
    ['Teto do Rebate (R$)', c => +c.rebate_teto || '', 'moeda'],
    ['Rebate Estimado (R$)', c => k(c).reb || 0, 'moeda'],
    ['Custo Total (R$)', c => k(c).total, 'moeda'],
    ['% Custo Total / Meta', c => (k(c).pctMeta == null ? '' : k(c).pctMeta), 'pct'],
    ['Status', c => c.status],
    ['Aprovador', c => c.aprovador_nome || ''],
    ['Data da Decisão', c => dataExcel(c.data_decisao), 'data'],
    ['Motivo da Reprova', c => c.motivo || ''],
    ['Origem', c => (c.importada ? 'Planilha antiga' : 'App')],
    ['Comprou no período (Qlik)', c => (c.compras_consultado_em ? +c.compras_periodo : ''), 'moeda'],
    ['Devoluções no período (Qlik)', c => (c.compras_consultado_em && c.compras_devolucoes != null ? +c.compras_devolucoes : ''), 'moeda'],
    ['Marcas consultadas (Qlik)', c => listaMarcas(c.compras_marca).join(', ')],
    ['Observações', c => c.observacoes || ''],
    ['Balconista (cadastro)', c => balc(c)?.nome_completo || ''],
    ['Nome do Recebedor Swile', c => c.swile_nome_completo || ''],
    ['CPF do Recebedor Swile', c => (c.swile_cpf ? maskCPF(c.swile_cpf) : '')],
    ['Data de Nascimento do Recebedor', c => dataExcel(c.swile_data_nascimento), 'data'],
    ['E-mail do Recebedor Swile', c => c.swile_email || ''],
    ['Telefone do Recebedor Swile', c => (c.swile_telefone ? maskTelefone(c.swile_telefone) : '')],
  ];
}

// "Ouro Fino Saúde Animal" → "Ouro-Fino-Saude-Animal": só letras e números, para o nome do arquivo.
export const nomeParaArquivo = txt => String(txt ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// prefixo: início do nome do arquivo (o Perfil exporta tudo; as listas, só o que está na tela).
export async function exportarExcel(lista, cad, { prefixo = 'Extrato_Campanhas' } = {}) {
  if (!lista.length) throw new ErroApp('Não há nada para exportar ainda.');
  let XLSX;
  try { XLSX = await import(SHEETJS); }
  catch { throw new ErroApp('A biblioteca do Excel não carregou. Confira a internet e tente de novo.'); }

  const cols = colunas(cad);
  const linhas = lista.map(c => cols.map(([, fn]) => fn({ ...c })));
  const ws = XLSX.utils.aoa_to_sheet([cols.map(([t]) => t), ...linhas]);

  cols.forEach(([titulo, , formato], i) => {
    const letra = colunaExcel(i);
    if (formato) {
      for (let l = 2; l <= linhas.length + 1; l++) {
        const cel = ws[letra + l];
        if (cel && cel.v !== '' && cel.v !== undefined) { cel.z = FORMATOS[formato]; if (formato === 'data') cel.t = 'n'; }
      }
    }
  });
  // Largura ajustada ao conteúdo (mínimo do cabeçalho, máximo 40).
  ws['!cols'] = cols.map(([titulo, , formato], i) => {
    let max = titulo.length;
    if (formato === 'data') max = Math.max(max, 10);
    else for (const l of linhas) max = Math.max(max, String(l[i] ?? '').length);
    return { wch: Math.min(max + 2, 40) };
  });
  ws['!autofilter'] = { ref: `A1:${colunaExcel(cols.length - 1)}${linhas.length + 1}` };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Campanhas');
  XLSX.writeFile(wb, `${prefixo}_${hojeCivil()}.xlsx`);
}
