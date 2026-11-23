// Qlik simulado para o servidor de desenvolvimento e para os testes de navegador.
// O Worker de verdade (worker/index.js) responde ao mesmo pedido e no mesmo formato.
//   cliente com código terminado em 0 → nenhuma nota
//   código 9999                       → erro do Qlik
//   os demais                         → 3 notas, de duas marcas (WELLPET e PROTEÇÃO); com "marca" no pedido, só as dela
export const ROTA_QLIK = '/api/qlik/compras';

export function qlikSimulado(rq, rs) {
  let corpo = '';
  rq.on('data', d => { corpo += d; });
  rq.on('end', () => setTimeout(() => {
    const responder = (status, obj) => { rs.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); rs.end(JSON.stringify(obj)); };
    if (!/^Bearer\s+\S+/.test(rq.headers.authorization || '')) return responder(401, { erro: 'Entre no app para consultar o Qlik.' });
    let p; try { p = JSON.parse(corpo); } catch { return responder(400, { erro: 'Pedido inválido.' }); }
    if (String(p.codigo_cliente) === '9999') return responder(502, { erro: 'Não foi possível consultar o Qlik agora.' });
    const vazio = String(p.codigo_cliente).endsWith('0');
    // Marcas do laboratório: WELLPET tem a nota 210818; PROTEÇÃO tem as outras duas.
    const todas = [
      { numero: '209001', serie: '1', data: p.inicio, valor: 300, marca: 'PROTEÇÃO' },
      { numero: '210818', serie: '1', data: p.inicio, valor: 1200.5, marca: 'WELLPET' },
      { numero: '211500', serie: '2', data: p.fim, valor: 99.99, marca: 'PROTEÇÃO' },
    ];
    const soma = l => Math.round(l.reduce((t, n) => t + n.valor, 0) * 100) / 100;
    const marcas = vazio ? [] : ['WELLPET', 'PROTEÇÃO'].map(nome => ({ nome, valor: soma(todas.filter(n => n.marca === nome)) })).sort((a, b) => b.valor - a.valor);
    const notas = (vazio ? [] : todas.filter(n => !p.marca || n.marca === p.marca)).map(({ marca, ...n }) => n);
    responder(200, {
      total: soma(notas), notas, marcas,
      fornecedores: vazio ? [] : ['OURO FINO SAUDE ANIMAL'], consultado_em: new Date().toISOString(),
    });
  }, 150));
}
