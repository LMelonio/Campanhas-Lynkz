-- ============================================================
--  Testes da migração 13: devoluções da consulta do Qlik gravadas na campanha.
--  Rodados por tests/banco/rodar.sh depois de testes-12.sql, como usuário comum
--  (set role authenticated), igual ao app.
--  Usuários (de testes.sql): 1111 coordenador (solicitante), 2222 aprovador,
--  4444 outro coordenador ativo.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop schema if exists t13 cascade;
create schema t13;
grant usage on schema t13 to authenticated, anon, service_role;
create function t13.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t13.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t13.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
-- Envio mínimo com as devoluções pedidas (o resto como o app manda).
create function t13.enviar(nome text, extra jsonb) returns void language sql as $$
  select null::void from (select public.enviar_campanha(
    jsonb_build_object('cliente', 'x', 'empresa_id', (select id from public.empresas where nome = 'Empresa das devoluções'),
      'laboratorio', 'Ouro Fino', 'campanha', nome) || extra)) s
$$;
grant execute on all functions in schema t13 to authenticated, anon, service_role;

update perfis set papel = 'coordenador', ativo = true where id in ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444');
update perfis set papel = 'aprovador', ativo = true where id = '22222222-2222-2222-2222-222222222222';

-- ---------- 1. usuário comum grava pelo enviar_campanha (permissões das colunas novas) ----------
set role authenticated;
select t13.logar('11111111-1111-1111-1111-111111111111');
insert into empresas (nome) values ('Empresa das devoluções');

select public.enviar_campanha(
  jsonb_build_object('cliente', 'x', 'empresa_id', (select id from empresas where nome = 'Empresa das devoluções'),
    'laboratorio', 'Ouro Fino', 'campanha', 'Com devolução',
    'compras_periodo', 1300.49, 'compras_consultado_em', now(),
    'compras_devolucoes', 300,
    'compras_devolvidas', '[{"numero":"209001","serie":"1","data":"2026-10-02","valor":300}]'::jsonb),
  null,
  '[{"numero":"210818","serie":"1","data":"2026-10-05","valor":1200.5}]'::jsonb);
select t13.ok((select compras_devolucoes = 300 and jsonb_array_length(compras_devolvidas) = 1
                      and compras_devolvidas->0->>'numero' = '209001'
               from campanhas_app where campanha = 'Com devolução'), 'coordenador grava devoluções e notas de provável devolução');
select t13.ok((select count(*) = 1 from campanha_notas n join campanhas c on c.id = n.campanha_id where c.campanha = 'Com devolução'),
  'a nota riscada não entra em campanha_notas (só a marcada)');

-- ---------- 2. compatibilidade: site 2.8.1 com a 13 no banco ----------
-- A 2.8.1 não manda as chaves novas: o envio continua funcionando e as colunas ficam nulas.
select public.enviar_campanha(
  jsonb_build_object('cliente', 'x', 'empresa_id', (select id from empresas where nome = 'Empresa das devoluções'),
    'laboratorio', 'Ouro Fino', 'campanha', 'Envio da 2.8.1', 'compras_periodo', 1600.49, 'compras_consultado_em', now()),
  null, '[{"numero":"209001","serie":"1","data":"2026-10-02","valor":300}]'::jsonb);
select t13.ok((select compras_periodo = 1600.49 and compras_devolucoes is null and compras_devolvidas is null
               from campanhas_app where campanha = 'Envio da 2.8.1'), 'envio no formato da 2.8.1 grava, com as devoluções nulas');

-- ---------- 3. limites (os dois campos vêm do aparelho de quem pede) ----------
select t13.enviar('Devolução no limite', '{"compras_devolucoes": 10000000}');
select t13.ok((select compras_devolucoes = 10000000 from campanhas_app where campanha = 'Devolução no limite'), 'R$ 10 milhões passa');
select t13.falha($$select t13.enviar('Acima do limite', '{"compras_devolucoes": 10000000.01}')$$, 'campanhas_devolucoes_faixa', 'acima de R$ 10 milhões é recusado');
select t13.falha($$select t13.enviar('Negativa', '{"compras_devolucoes": -1}')$$, 'campanhas_devolucoes_faixa', 'devolução negativa é recusada');
select t13.enviar('Lista de 50', jsonb_build_object('compras_devolvidas',
  (select jsonb_agg(jsonb_build_object('numero', g::text, 'serie', '1', 'valor', 1)) from generate_series(1, 50) g)));
select t13.ok((select jsonb_array_length(compras_devolvidas) = 50 from campanhas_app where campanha = 'Lista de 50'), 'lista de 50 notas passa');
select t13.falha($$select t13.enviar('Lista de 51', jsonb_build_object('compras_devolvidas',
  (select jsonb_agg(jsonb_build_object('numero', g::text, 'serie', '1', 'valor', 1)) from generate_series(1, 51) g)))$$,
  'campanhas_devolucoes_faixa', 'lista com mais de 50 notas é recusada');
select t13.falha($$select t13.enviar('Não é lista', '{"compras_devolvidas": {"numero": "1"}}')$$, 'campanhas_devolucoes_faixa', 'compras_devolvidas precisa ser uma lista');
select t13.falha($$select t13.enviar('Texto', '{"compras_devolvidas": "209001"}')$$, 'campanhas_devolucoes_faixa', 'texto solto em compras_devolvidas é recusado');

-- ---------- 4. quem lê (view campanhas_app) ----------
select t13.ok((select compras_devolucoes = 300 and compras_devolvidas is not null from campanhas_app where campanha = 'Com devolução'), 'solicitante lê as duas colunas');
select t13.logar('22222222-2222-2222-2222-222222222222');
select t13.ok((select compras_devolucoes = 300 and compras_devolvidas is not null from campanhas_app where campanha = 'Com devolução'), 'aprovador lê as duas colunas');
select t13.logar('44444444-4444-4444-4444-444444444444');
select t13.ok((select compras_devolucoes = 300 and compras_devolvidas is not null from campanhas_app where campanha = 'Com devolução'), 'outro usuário ativo lê as duas colunas');

-- ---------- 5. ninguém altera depois de enviada ----------
select t13.logar('11111111-1111-1111-1111-111111111111');
select t13.falha($$update campanhas set compras_devolucoes = 0 where campanha = 'Com devolução'$$, 'permission denied', 'solicitante não altera as devoluções');
select t13.logar('22222222-2222-2222-2222-222222222222');
select t13.falha($$update campanhas set compras_devolvidas = '[]' where campanha = 'Com devolução'$$, 'permission denied', 'aprovador não altera as devoluções');
reset role;

-- ---------- 6. visitante sem login ----------
set role anon;
select t13.falha($$select compras_devolucoes from campanhas_app$$, 'permission denied', 'visitante não lê as devoluções');
select t13.falha($$select compras_devolucoes from campanhas$$, 'permission denied', 'visitante não lê a tabela');
reset role;

drop schema t13 cascade;
\echo 'TESTES DA 13 PASSARAM'
