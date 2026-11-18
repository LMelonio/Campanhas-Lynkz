-- ============================================================
--  00 — DIAGNÓSTICO (SÓ LEITURA: nenhuma consulta altera dados,
--  permissões ou estrutura — todas são SELECT)
--
--  Supabase → SQL Editor. O editor mostra só o resultado da última
--  consulta executada, então rode UMA por vez: selecione do comentário
--  "-- Dn" até o ponto e vírgula e clique em "Run selected" (ou cole
--  uma de cada vez numa aba nova).
--
--  Para ter certeza absoluta de que nada é gravado, você pode envolver
--  qualquer consulta assim:   begin read only;  <consulta>  rollback;
--  (o Postgres recusa qualquer escrita dentro de "read only").
-- ============================================================

-- D1. Todas as contas, das mais novas para as mais antigas.
select
  u.email,
  u.created_at::date               as criada_em,
  u.last_sign_in_at::date          as ultimo_acesso,
  u.email_confirmed_at is not null as email_confirmado,
  p.papel, p.ativo, p.nome,
  case
    when p.id is null                         then 'SEM PERFIL'
    when u.email not ilike '%@lynkz.com.br'   then 'FORA DO DOMÍNIO'
    when u.email_confirmed_at is null         then 'NÃO CONFIRMADA'
    else ''
  end as suspeita
from auth.users u
left join public.perfis p on p.id = u.id
order by u.created_at desc;

-- D2. Regras (policies) atuais das duas tabelas.
select tablename, policyname, permissive, cmd, roles, qual as usando, with_check
from pg_policies
where schemaname = 'public' and tablename in ('campanhas','perfis')
order by tablename, policyname;

-- D3. Permissões de TABELA dos papéis usados pelo app.
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as permissoes
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('campanhas','perfis','campanhas_app')
  and grantee in ('anon','authenticated')
group by 1,2 order by 1,2;

-- D3b. Permissões de COLUNA que não vêm da permissão de tabela.
select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges cp
where table_schema = 'public' and table_name in ('campanhas','perfis')
  and grantee in ('anon','authenticated')
  and not exists (select 1 from information_schema.role_table_grants tg
                  where tg.table_schema = cp.table_schema and tg.table_name = cp.table_name
                    and tg.grantee = cp.grantee and tg.privilege_type = cp.privilege_type)
order by 1,2,3,4;

-- D4. Colunas reais da tabela campanhas.
select ordinal_position as n, column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'campanhas'
order by ordinal_position;

-- D5. Tabelas no canal de tempo real.
select pubname, schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime';

-- D6. Versão do Postgres (a parte B precisa de 15 ou mais).
select current_setting('server_version') as versao_postgres;

-- D7. Contagem e assinatura dos registros — guarde o resultado e compare
--     depois da migração (tem que ser idêntico).
select
  (select count(*) from public.campanhas)                                 as campanhas,
  (select count(*) from public.campanhas where status = 'Aprovada')       as aprovadas,
  (select count(*) from public.campanhas where status = 'Reprovada')      as reprovadas,
  (select count(*) from public.campanhas where status = 'Pendente')       as pendentes,
  (select count(*) from public.campanhas where forma_pagamento = 'Swile') as swile,
  (select count(*) from public.perfis)                                    as perfis,
  (select md5(coalesce(string_agg(t::text, '|' order by id), ''))  from public.campanhas t) as assinatura_campanhas,
  (select md5(coalesce(string_agg(p::text, '|' order by id::text), '')) from public.perfis p) as assinatura_perfis;

-- D8. Gatilhos e funções do app que já existem.
select 'trigger' as tipo, tgname as nome, tgrelid::regclass::text as em
from pg_trigger
where not tgisinternal and tgrelid in ('public.campanhas'::regclass, 'public.perfis'::regclass, 'auth.users'::regclass)
union all
select 'funcao', p.proname, 'public'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('eh_aprovador','eh_ativo','registrar_decisao','carimbar_solicitacao','criar_perfil',
                    'cpf_valido','pode_ver_swile','swile_da_campanha')
order by 1,2;

-- D9. Quem continua com acesso depois da parte A (só perfis ativos).
select papel, ativo, count(*) as pessoas
from public.perfis
group by papel, ativo
order by papel, ativo desc;

-- D10. FOTO PARA ROLLBACK EXATO. Gera (não executa) o SQL que devolve
--      regras, permissões e trava ao estado de AGORA, mesmo que o banco
--      tenha alguma diferença em relação ao schema.sql. Copie o texto da
--      célula "sql_para_restaurar" e salve num arquivo, por exemplo
--      rollback-exato-AAAA-MM-DD.sql. Só use se precisar desfazer a parte A.
select string_agg(linha, E'\n' order by ordem, sub) as sql_para_restaurar
from (
  select 0 as ordem, 0 as sub, '-- Rollback exato gerado em ' || now()::text || E'\nbegin;\nset local lock_timeout = ''5s'';' as linha
  union all
  select 1, 0, 'drop trigger if exists ao_solicitar on public.campanhas;'
  union all
  select 1, 1, 'drop function if exists public.carimbar_solicitacao();'
  union all
  -- apaga as regras que existirem na hora do rollback
  select 2, 0, $q$do $x$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and tablename in ('campanhas','perfis') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop; end $x$;$q$
  union all
  -- recria as regras de agora, uma a uma
  select 3, row_number() over (order by tablename, policyname)::int,
         format('create policy %I on public.%I as %s for %s to %s%s%s;',
                policyname, tablename, permissive, cmd,
                (select string_agg(quote_ident(r), ', ') from unnest(roles) r),
                coalesce(' using (' || qual || ')', ''),
                coalesce(' with check (' || with_check || ')', ''))
  from pg_policies
  where schemaname = 'public' and tablename in ('campanhas','perfis')
  union all
  select 4, 0, 'revoke all on public.campanhas, public.perfis from anon, authenticated;'
  union all
  -- permissões lidas direto do catálogo (inclui MAINTAIN, do Postgres 17,
  -- que o information_schema não mostra)
  select 5, row_number() over (order by c.relname, r.rolname)::int,
         format('grant %s on public.%I to %I;', string_agg(a.privilege_type, ', ' order by a.privilege_type), c.relname, r.rolname)
  from pg_class c
  cross join lateral aclexplode(c.relacl) a
  join pg_roles r on r.oid = a.grantee
  where c.oid in ('public.campanhas'::regclass, 'public.perfis'::regclass) and r.rolname in ('anon','authenticated')
  group by c.relname, r.rolname
  union all
  select 6, row_number() over (order by c.relname, at.attname, r.rolname, a.privilege_type)::int,
         format('grant %s (%I) on public.%I to %I;', a.privilege_type, at.attname, c.relname, r.rolname)
  from pg_class c
  join pg_attribute at on at.attrelid = c.oid and at.attnum > 0 and not at.attisdropped and at.attacl is not null
  cross join lateral aclexplode(at.attacl) a
  join pg_roles r on r.oid = a.grantee
  where c.oid in ('public.campanhas'::regclass, 'public.perfis'::regclass) and r.rolname in ('anon','authenticated')
  union all
  select 7, 0, pg_get_functiondef('public.registrar_decisao()'::regprocedure) || ';'
  union all
  select 8, 0, case when to_regprocedure('public.eh_ativo()') is null
                    then 'drop function if exists public.eh_ativo();'
                    else '-- eh_ativo() já existia antes: mantida' end
  union all
  select 9, 0, 'commit;'
) x;
