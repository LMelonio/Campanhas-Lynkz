-- ============================================================
--  Testes da migração 14: fornecedores (até 5) e divisão da meta e do
--  investimento da indústria por fornecedor. Rodados por tests/banco/rodar.sh
--  depois de testes-13.sql, como usuário comum (set role authenticated), igual ao app.
--  Usuários (de testes.sql): 1111 coordenador (solicitante), 2222 aprovador,
--  4444 outro coordenador ativo.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop schema if exists t14 cascade;
create schema t14;
grant usage on schema t14 to authenticated, anon, service_role;
create function t14.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t14.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t14.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
-- Envio como o app manda: laboratorio com os nomes juntos, meta/indústria com a soma e a divisão.
create function t14.enviar(nome text, lab text, meta numeric, ind numeric, forn jsonb) returns void language sql as $$
  select null::void from (select public.enviar_campanha(
    jsonb_build_object('cliente', 'x', 'empresa_id', (select id from public.empresas where nome = 'Empresa dos fornecedores'),
      'laboratorio', lab, 'campanha', nome, 'meta', meta, 'investimento_industria', ind, 'rebate_pct', 2, 'rebate_teto', 500)
    || case when forn is null then '{}'::jsonb else jsonb_build_object('fornecedores', forn) end)) s
$$;
grant execute on all functions in schema t14 to authenticated, anon, service_role;

update perfis set papel = 'coordenador', ativo = true where id in ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444');
update perfis set papel = 'aprovador', ativo = true where id = '22222222-2222-2222-2222-222222222222';

set role authenticated;
select t14.logar('11111111-1111-1111-1111-111111111111');
insert into empresas (nome) values ('Empresa dos fornecedores');

-- ---------- 1. divisão válida ----------
select t14.enviar('Dividida', 'Ouro Fino, Avert', 30000, 1500,
  '[{"nome":"Ouro Fino","meta":20000,"investimento_industria":1000},{"nome":"Avert","meta":10000,"investimento_industria":500}]');
select t14.ok((select jsonb_array_length(fornecedores) = 2 and meta = 30000 and investimento_industria = 1500
                      and fornecedores->1->>'nome' = 'Avert'
               from campanhas_app where campanha = 'Dividida'), 'coordenador grava a divisão por fornecedor');
select t14.enviar('Centavos', 'Ouro Fino, Avert, Vansil', 0.3, 0,
  '[{"nome":"Ouro Fino","meta":0.1,"investimento_industria":0},{"nome":"Avert","meta":0.2,"investimento_industria":0},{"nome":"Vansil","meta":0,"investimento_industria":0}]');
select t14.ok(exists (select 1 from campanhas_app where campanha = 'Centavos'), 'soma com centavos (0,1 + 0,2 = 0,3) confere');
select t14.enviar('Maiúsculas', 'Ouro Fino, Avert', 2, 0,
  '[{"nome":"ouro fino","meta":1,"investimento_industria":0},{"nome":" AVERT ","meta":1,"investimento_industria":0}]');
select t14.ok(exists (select 1 from campanhas_app where campanha = 'Maiúsculas'), 'nome confere sem diferenciar maiúsculas e espaços');

-- ---------- 2. sem divisão continua igual (site 2.12 ou campanha que não divide) ----------
select t14.enviar('Sem divisão', 'Ouro Fino, Avert, Vansil, Premier, Farmina', 50000, 0, null);
select t14.ok((select fornecedores is null and meta = 50000 from campanhas_app where campanha = 'Sem divisão'), '5 fornecedores sem divisão gravam, com fornecedores nulo');

-- ---------- 3. divisão que não confere é recusada ----------
select t14.falha($$select t14.enviar('Soma errada', 'Ouro Fino, Avert', 30001, 1500,
  '[{"nome":"Ouro Fino","meta":20000,"investimento_industria":1000},{"nome":"Avert","meta":10000,"investimento_industria":500}]')$$,
  'campanhas_fornecedores_valido', 'meta total diferente da soma é recusada');
select t14.falha($$select t14.enviar('Indústria errada', 'Ouro Fino, Avert', 30000, 1000,
  '[{"nome":"Ouro Fino","meta":20000,"investimento_industria":1000},{"nome":"Avert","meta":10000,"investimento_industria":500}]')$$,
  'campanhas_fornecedores_valido', 'indústria total diferente da soma é recusada');
select t14.falha($$select t14.enviar('Outro nome', 'Ouro Fino, Avert', 2, 0,
  '[{"nome":"Ouro Fino","meta":1,"investimento_industria":0},{"nome":"Vansil","meta":1,"investimento_industria":0}]')$$,
  'campanhas_fornecedores_valido', 'fornecedor que não é da campanha é recusado');
select t14.falha($$select t14.enviar('Faltou um', 'Ouro Fino, Avert, Vansil', 2, 0,
  '[{"nome":"Ouro Fino","meta":1,"investimento_industria":0},{"nome":"Avert","meta":1,"investimento_industria":0}]')$$,
  'campanhas_fornecedores_valido', 'divisão sem todos os fornecedores é recusada');
select t14.falha($$select t14.enviar('Repetido', 'Ouro Fino, Avert', 2, 0,
  '[{"nome":"Ouro Fino","meta":1,"investimento_industria":0},{"nome":"ouro fino","meta":1,"investimento_industria":0}]')$$,
  'campanhas_fornecedores_valido', 'fornecedor repetido na divisão é recusado');
select t14.falha($$select t14.enviar('Um só', 'Ouro Fino', 1, 0, '[{"nome":"Ouro Fino","meta":1,"investimento_industria":0}]')$$,
  'campanhas_fornecedores_valido', 'divisão com um fornecedor só é recusada');
select t14.falha($$select t14.enviar('Negativa', 'Ouro Fino, Avert', 0, 0,
  '[{"nome":"Ouro Fino","meta":1,"investimento_industria":0},{"nome":"Avert","meta":-1,"investimento_industria":0}]')$$,
  'campanhas_fornecedores_valido', 'meta negativa na divisão é recusada');
select t14.falha($$select t14.enviar('Texto', 'Ouro Fino, Avert', 2, 0,
  '[{"nome":"Ouro Fino","meta":"1","investimento_industria":0},{"nome":"Avert","meta":1,"investimento_industria":0}]')$$,
  'campanhas_fornecedores_valido', 'meta em texto é recusada (sem erro de conversão)');
select t14.falha($$select t14.enviar('Não é lista', 'Ouro Fino, Avert', 2, 0, '{"nome":"Ouro Fino"}')$$,
  'campanhas_fornecedores_valido', 'divisão que não é lista é recusada');
select t14.falha($$select t14.enviar('Acima do limite', 'Ouro Fino, Avert', 10000001, 10000001,
  '[{"nome":"Ouro Fino","meta":10000000,"investimento_industria":10000001},{"nome":"Avert","meta":1,"investimento_industria":0}]')$$,
  '', 'indústria acima de R$ 10 milhões num fornecedor é recusada');

-- ---------- 4. no máximo 5 fornecedores ----------
select t14.falha($$select t14.enviar('Seis', 'Ouro Fino, Avert, Vansil, Premier, Farmina, Kelco', 0, 0, null)$$,
  'campanhas_fornecedores_max', '6 fornecedores são recusados');

-- ---------- 5. quem lê ----------
select t14.logar('22222222-2222-2222-2222-222222222222');
select t14.ok((select fornecedores is not null from campanhas_app where campanha = 'Dividida'), 'aprovador lê a divisão');
select t14.logar('44444444-4444-4444-4444-444444444444');
select t14.ok((select fornecedores is not null from campanhas_app where campanha = 'Dividida'), 'outro usuário ativo lê a divisão');

-- ---------- 6. ninguém altera depois de enviada ----------
select t14.logar('11111111-1111-1111-1111-111111111111');
select t14.falha($$update campanhas set fornecedores = null where campanha = 'Dividida'$$, 'permission denied', 'solicitante não altera a divisão');
select t14.logar('22222222-2222-2222-2222-222222222222');
select t14.falha($$update campanhas set fornecedores = null where campanha = 'Dividida'$$, 'permission denied', 'aprovador não altera a divisão');
reset role;

-- ---------- 7. visitante sem login ----------
set role anon;
select t14.falha($$select fornecedores from campanhas_app$$, 'permission denied', 'visitante não lê a divisão');
reset role;

drop schema t14 cascade;
\echo 'TESTES DA 14 PASSARAM'
