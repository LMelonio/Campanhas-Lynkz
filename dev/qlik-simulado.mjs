// Qlik simulado para o servidor de desenvolvimento e para os testes de navegador.
// O Worker de verdade (worker/index.js) responde ao mesmo pedido e no mesmo formato.
//   cliente com código terminado em 0 → nenhuma nota
//   código 9999                       → erro do Qlik
//   os demais                         → 3 notas
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
    const notas = vazio ? [] : [
      { numero: '209001', serie: '1', data: p.inicio, valor: 300 },
      { numero: '210818', serie: '1', data: p.inicio, valor: 1200.5 },
      { numero: '211500', serie: '2', data: p.fim, valor: 99.99 },
    ];
    responder(200, {
      total: Math.round(notas.reduce((t, n) => t + n.valor, 0) * 100) / 100, notas,
      fornecedores: vazio ? [] : ['OURO FINO SAUDE ANIMAL'], consultado_em: new Date().toISOString(),
    });
  }, 150));
}
