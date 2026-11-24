// Qlik simulado para o servidor de desenvolvimento e para os testes de navegador.
// O Worker de verdade (worker/index.js) responde ao mesmo pedido e no mesmo formato.
//   cliente com código terminado em 0 → nenhuma nota deste laboratório (comprou R$ 850 de outros)
//   cliente com código terminado em 00 → o Qlik não devolve nada do cliente (cliente_total 0)
//   código 9999                       → erro do Qlik
//   código terminado em 12            → 12 notas (lista recolhida em 5, v2.9)
//   código terminado em 7             → NF 209001 (R$ 300) devolvida: vem como provável devolução (v2.9)
//   código terminado em 8             → devolução de R$ 50 sem nota que feche (v2.9)
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
    const doze = String(p.codigo_cliente).endsWith('12');
    if (doze) {
      const geradas = Array.from({ length: 12 }, (_, i) => ({
        numero: String(220001 + i), serie: '1', data: p.inicio, valor: 100 + i, marca: i % 2 ? 'WELLPET' : 'PROTEÇÃO' }));
      todas.length = 0;
      todas.push(...geradas);
    }
    const soma = l => Math.round(l.reduce((t, n) => t + n.valor, 0) * 100) / 100;
    const marcas = vazio ? [] : ['WELLPET', 'PROTEÇÃO'].map(nome => ({ nome, valor: soma(todas.filter(n => n.marca === nome)) })).sort((a, b) => b.valor - a.valor);
    let notas = (vazio ? [] : todas.filter(n => !p.marca || n.marca === p.marca)).map(({ marca, ...n }) => n);
    // Devoluções (v2.9): o total já desconta; devolucoes = soma das notas − total.
    const cod = String(p.codigo_cliente);
    const devolucoes = vazio || p.marca ? 0 : cod.endsWith('7') ? 300 : cod.endsWith('8') ? 50 : 0;
    if (cod.endsWith('7') && !vazio && !p.marca) notas = notas.map(n => (n.numero === '209001' ? { ...n, provavel_devolucao: true } : n));
    responder(200, {
      total: Math.round((soma(notas) - devolucoes) * 100) / 100, notas, devolucoes, marcas,
      fornecedores: vazio ? [] : ['OURO FINO SAUDE ANIMAL'], consultado_em: new Date().toISOString(),
      cliente_total: vazio ? (String(p.codigo_cliente).endsWith('00') ? 0 : 850) : null,
    });
  }, 150));
}
