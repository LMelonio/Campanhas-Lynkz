// Worker: convite de usuário (/api/usuarios/convidar) com o Supabase falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { validarConvite } from '../worker/index.js';

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'servico' };
const pedido = (corpo, { token = 'a.b.c', origem = 'https://app.test' } = {}) => new Request('https://app.test/api/usuarios/convidar', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: origem }, body: JSON.stringify(corpo),
});
const CORPO = { nome: 'Maria Lima', email: 'maria@lynkz.com.br', papel: 'coordenador' };

// Supabase falso: papel de quem convida, resposta do invite e registro das chamadas.
function supabaseFalso({ papel = 'aprovador', ativo = true, invite = { status: 200, corpo: { id: 'u-novo' } }, rpc = 200 } = {}) {
  const chamadas = [];
  globalThis.fetch = async (url, op = {}) => {
    const u = String(url);
    chamadas.push({ url: u, op });
    const r = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status });
    if (u.endsWith('/auth/v1/user')) return r({ id: 'u-admin' });
    if (u.includes('/rest/v1/perfis')) return r([{ ativo, papel }]);
    if (u.includes('/auth/v1/invite')) return r(invite.corpo, invite.status);
    if (u.includes('/rest/v1/rpc/definir_perfil')) return r({}, rpc);
    return r({ erro: 'rota inesperada' }, 500);
  };
  return chamadas;
}

test('validarConvite normaliza e recusa dados ruins', () => {
  assert.deepEqual(validarConvite({ nome: ' Ana  Lima ', email: ' ANA@X.COM ', papel: 'aprovador' }), { nome: 'Ana Lima', email: 'ana@x.com', papel: 'aprovador' });
  for (const ruim of [null, [], { ...CORPO, email: 'sem-arroba' }, { ...CORPO, nome: 'A' }, { ...CORPO, papel: 'dono' }]) {
    assert.throws(() => validarConvite(ruim), e => e.status === 400);
  }
});

test('administrador convida: invite com o serviço e perfil pela definir_perfil com o token dele', async () => {
  const ch = supabaseFalso();
  const resp = await worker.fetch(pedido(CORPO), ENV);
  assert.equal(resp.status, 201);
  assert.deepEqual(await resp.json(), { id: 'u-novo', email: 'maria@lynkz.com.br' });
  const inv = ch.find(c => c.url.includes('/auth/v1/invite'));
  assert.ok(inv.url.includes('redirect_to=' + encodeURIComponent('https://app.test/')), 'volta para o app');
  assert.equal(inv.op.headers.Authorization, 'Bearer servico', 'invite usa a chave de serviço');
  assert.deepEqual(JSON.parse(inv.op.body), { email: 'maria@lynkz.com.br', data: { nome: 'Maria Lima' } });
  const rpc = ch.find(c => c.url.includes('definir_perfil'));
  assert.equal(rpc.op.headers.Authorization, 'Bearer a.b.c', 'perfil definido com o token de quem convidou');
  assert.deepEqual(JSON.parse(rpc.op.body), { p_id: 'u-novo', p_papel: 'coordenador', p_ativo: true, p_nome: 'Maria Lima' });
});

test('quem não é administrador ativo não convida', async () => {
  supabaseFalso({ papel: 'coordenador' });
  assert.equal((await worker.fetch(pedido(CORPO), ENV)).status, 403);
  supabaseFalso({ ativo: false });
  assert.equal((await worker.fetch(pedido(CORPO), ENV)).status, 403);
  supabaseFalso();
  assert.equal((await worker.fetch(pedido(CORPO, { token: '' }), ENV)).status, 401);
  assert.equal((await worker.fetch(pedido(CORPO, { origem: 'https://outro.site' }), ENV)).status, 403);
});

test('e-mail já cadastrado, sem chave no servidor e perfil não definido', async () => {
  supabaseFalso({ invite: { status: 422, corpo: { msg: 'A user with this email address has already been registered' } } });
  let r = await worker.fetch(pedido(CORPO), ENV);
  assert.equal(r.status, 409);
  assert.match((await r.json()).erro, /Já existe/);
  supabaseFalso();
  r = await worker.fetch(pedido(CORPO), { ...ENV, SUPABASE_SERVICE_ROLE_KEY: '' });
  assert.equal(r.status, 503);
  assert.match((await r.json()).erro, /falta configurar/);
  supabaseFalso({ rpc: 500 });
  r = await worker.fetch(pedido(CORPO), ENV);
  assert.equal(r.status, 201);
  assert.match((await r.json()).aviso, /Confira o perfil/);
});
