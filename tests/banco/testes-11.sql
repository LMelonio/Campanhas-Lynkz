-- ============================================================
--  Testes da migração 11: enviar_campanha (balconista + campanha + notas
--  numa transação só). Rodados por tests/banco/rodar.sh depois de testes-10.sql.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema t11;
grant usage on schema t11 to authenticated, anon, service_role;
create function t11.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t11.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t11.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant execute on all functions in schema t11 to authenticated, anon, service_role;

insert into auth.users values ('88888888-8888-8888-8888-888888888888', 'outro.coordenador@lynkz.com.br') on conflict do nothing;
update perfis set ativo = true where id = '88888888-8888-8888-8888-888888888888';

set role authenticated;
select t11.logar('11111111-1111-1111-1111-111111111111');
insert into empresas (nome) values ('Empresa do envio único');

-- 1. caminho feliz: balconista novo + campanha + 2 notas, tudo junto
create temp table resultado11 as
select public.enviar_campanha(
  jsonb_build_object(
    'cliente', 'x', 'empresa_id', (select id from empresas where nome = 'Empresa do envio único'),
    'laboratorio', 'Avert', 'campanha', 'Envio único', 'forma_pagamento', 'Swile',
    'investimento_lynkz', 500, 'meta', 10000,
    'swile_nome_completo', 'Maria Silva Santos', 'swile_cpf', '52998224725', 'swile_data_nascimento', '1992-04-12',
    'swile_email', 'maria@exemplo.com', 'swile_telefone', '98999990001',
    'solicitante_id', '88888888-8888-8888-8888-888888888888', 'status', 'Aprovada'),
  jsonb_build_object(
    'empresa_id', (select id from empresas where nome = 'Empresa do envio único'),
    'nome_completo', 'Maria Silva Santos', 'cpf', '52998224725', 'data_nascimento', '1992-04-12',
    'email', 'maria@exemplo.com', 'telefone', '98999990001'),
  '[{"numero":"1001","serie":"1","data":"2026-10-02","valor":300},{"numero":"1002","serie":"1","data":"2026-10-05","valor":450.5}]'::jsonb
) as r;
select t11.ok((select count(*) = 1 from balconistas where cpf = '52998224725'), 'envio cadastra o balconista');
select t11.ok((select count(*) = 1 from campanhas_app where campanha = 'Envio único' and status = 'Pendente'
                and balconista_id = (select id from balconistas where cpf = '52998224725')), 'campanha nasce Pendente e ligada ao balconista');
select t11.ok((select solicitante_id = '11111111-1111-1111-1111-111111111111' from campanhas_app where campanha = 'Envio único'),
  'solicitante é quem chamou, não o que veio no JSON');
select t11.ok((select count(*) = 2 from campanha_notas where campanha_id = (select (r->>'id')::bigint from resultado11)), 'notas gravadas junto');
select t11.ok((select (r->>'codigo') is not null from resultado11), 'devolve o código da campanha');

-- 2. tudo ou nada: campanha recusada não deixa balconista novo para trás
select t11.falha($$select public.enviar_campanha(
  (select jsonb_build_object('cliente','x','empresa_id', id,'laboratorio','Avert','campanha','Recusada','rebate_pct',150) from empresas where nome = 'Empresa do envio único'),
  (select jsonb_build_object('empresa_id', id,'nome_completo','João Pedro Lima','cpf','11144477735','data_nascimento','1988-09-30','email','joao@exemplo.com','telefone','99999990002') from empresas where nome = 'Empresa do envio único'),
  '[]'::jsonb)$$, 'campanhas_valores_faixa', 'rebate 150 é recusado pelo banco');
select t11.ok((select count(*) = 0 from balconistas where cpf = '11144477735'), 'balconista NÃO fica cadastrado quando a campanha é recusada');
select t11.ok((select count(*) = 0 from campanhas_app where campanha = 'Recusada'), 'campanha recusada não existe');

-- 3. nota repetida derruba o envio inteiro
select t11.falha($$select public.enviar_campanha(
  (select jsonb_build_object('cliente','x','empresa_id', id,'laboratorio','Avert','campanha','Nota repetida') from empresas where nome = 'Empresa do envio único'),
  null,
  '[{"numero":"7","serie":"1","valor":1},{"numero":"7","serie":"1","valor":1}]'::jsonb)$$, 'campanha_notas_unica', 'nota repetida recusa o envio');
select t11.ok((select count(*) = 0 from campanhas_app where campanha = 'Nota repetida'), 'e a campanha não fica sem as notas');

-- 4. balconista já cadastrado: atualiza e usa o mesmo id
select public.enviar_campanha(
  (select jsonb_build_object('cliente','x','empresa_id', id,'laboratorio','Avert','campanha','Com cadastro existente') from empresas where nome = 'Empresa do envio único'),
  (select jsonb_build_object('id', b.id, 'nome_completo','Maria Silva Souza','cpf','52998224725','data_nascimento','1992-04-12','email','maria@exemplo.com','telefone','98999990001')
     from balconistas b where cpf = '52998224725'));
select t11.ok((select nome_completo = 'Maria Silva Souza' from balconistas where cpf = '52998224725'), 'atualiza o cadastro do balconista existente');
select t11.ok((select count(*) = 1 from balconistas where cpf = '52998224725'), 'sem duplicar o balconista');

-- 5. só logado executa
reset role;
set role anon;
select t11.falha($$select public.enviar_campanha('{}'::jsonb)$$, 'permission denied', 'visitante não executa enviar_campanha');
reset role;

select t11.logar('');
drop schema t11 cascade;
\echo 'TESTES DA 11 PASSARAM'
