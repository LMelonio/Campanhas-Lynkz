// Excel das comissões do mês, no formato da planilha "Comissões Lynkz - <Mês> <Ano>".
// O conteúdo (abas, células, fórmulas) vem de lib/comissoes-documentos.js → modeloExcel(); aqui só escreve com o SheetJS.
import { modeloExcel } from './lib/comissoes-documentos.js';
import { ErroApp } from './dados/erros.js';

const SHEETJS = new URL('../vendor/xlsx-0.20.3.min.js', import.meta.url).href;
const FORMATOS = { moeda: '"R$" #,##0.00', pct: '0.0%', data: 'dd/mm/yyyy', int: '0' };

function planilha(XLSX, aba) {
  const ws = {};
  let maxC = 0;
  aba.linhas.forEach((linha, r) => {
    (linha || []).forEach((cel, c) => {
      if (!cel) return;
      const x = {};
      if (typeof cel.v === 'number') { x.t = 'n'; x.v = cel.v; } else { x.t = 's'; x.v = cel.v == null ? '' : String(cel.v); }
      if (cel.f) x.f = cel.f;
      if (FORMATOS[cel.z] && x.t === 'n') x.z = FORMATOS[cel.z];
      ws[XLSX.utils.encode_cell({ r, c })] = x;
      maxC = Math.max(maxC, c);
    });
  });
  const ultima = Math.max(0, aba.linhas.length - 1);
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: ultima, c: maxC } });
  if (aba.larguras) ws['!cols'] = aba.larguras.map(wch => ({ wch }));
  if (aba.filtro) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: ultima, c: maxC } }) };
  return ws;
}

// resultado: apurarMes · opcoes: { parametros, cadastro, premiacoes, base }
export async function baixarExcelComissoes(resultado, opcoes) {
  let XLSX;
  try { XLSX = await import(SHEETJS); }
  catch { throw new ErroApp('A biblioteca do Excel não carregou. Confira a internet e tente de novo.'); }
  const { abas, arquivo } = modeloExcel(resultado, opcoes);
  const wb = XLSX.utils.book_new();
  for (const aba of abas) XLSX.utils.book_append_sheet(wb, planilha(XLSX, aba), aba.nome);
  XLSX.writeFile(wb, arquivo);
  return { arquivo, abas: abas.map(a => a.nome) };
}
