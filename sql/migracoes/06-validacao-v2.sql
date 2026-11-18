-- ============================================================
--  06 — VALIDAÇÃO DA v2 (só leitura)
--
--  Não grava nada. Cole no SQL Editor e clique em Run.
--  Esperado: 12 linhas, todas com ok = true.
--  Para os testes de comportamento (coordenador, aprovador, desativado),
--  rode também 03-validacao.sql, que desfaz tudo o que cria.
-- ============================================================
with
pol as (
  select tablename, policyname, cmd
  from pg_policies
  where schemaname = 'public' and tablename in ('empresas','balconistas')
)
select n, ok, teste from (values
  (1, to_regclass('public.empresas') is not null and to_regclass('public.balconistas') is not null,
      'Tabelas empresas e balconistas existem'),

  (2, coalesce((select bool_and(relrowsecurity) from pg_class
                where oid in (to_regclass('public.empresas'), to_regclass('public.balconistas'))), false),
      'RLS ligada nas duas tabelas'),

  (3, (select count(*) from pol where cmd in ('SELECT','INSERT','UPDATE')) = 6,
      '6 policies (leitura, cadastro e edição nas duas tabelas)'),

  (4, (select count(*) from pol where cmd in ('DELETE','ALL')) = 0,
      'Nenhuma policy de delete'),

  (5, not exists (select 1 from unnest(array['public.empresas','public.balconistas',
                                             'public.campanhas','public.campanhas_app']) t
                  where has_any_column_privilege('anon', t, 'SELECT,INSERT,UPDATE')
                     or has_table_privilege('anon', t, 'DELETE,TRUNCATE')),
      'Visitante sem login (anon) sem acesso'),

  (6, not exists (select 1 from unnest(array['public.empresas','public.balconistas','public.campanhas']) t
                  where has_table_privilege('authenticated', t, 'DELETE,TRUNCATE')),
      'Usuário logado não apaga nada'),

  (7, (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'campanhas_app'
         and column_name in ('empresa_id','balconista_id')) = 2,
      'View campanhas_app com empresa_id e balconista_id'),

  (8, not has_column_privilege('authenticated', 'public.campanhas', 'swile_cpf', 'SELECT'),
      'swile_cpf sem leitura direta na tabela'),

  (9, has_column_privilege('authenticated', 'public.campanhas', 'empresa_id', 'INSERT')
      and has_column_privilege('authenticated', 'public.campanhas', 'balconista_id', 'INSERT')
      and not has_column_privilege('authenticated', 'public.campanhas', 'empresa_id', 'UPDATE'),
      'Insert de empresa_id e balconista_id liberado (update não)'),

  (10, exists (select 1 from pg_trigger
               where tgname = 'ao_vincular_campanha' and tgrelid = 'public.campanhas'::regclass
                 and tgenabled <> 'D'),
      'Trigger ao_vincular_campanha ativo'),

  (11, coalesce((select prosrc like '%America/Fortaleza%' from pg_proc
                 where proname = 'registrar_decisao' and pronamespace = 'public'::regnamespace), false),
      'registrar_decisao usa o fuso America/Fortaleza'),

  (12, not has_column_privilege('authenticated', 'public.empresas',    'criado_por',     'INSERT')
       and not has_column_privilege('authenticated', 'public.empresas',    'atualizado_por', 'UPDATE')
       and not has_column_privilege('authenticated', 'public.balconistas', 'id',             'INSERT')
       and not has_column_privilege('authenticated', 'public.balconistas', 'empresa_id',     'UPDATE')
       and not has_function_privilege('authenticated', 'public.reaplicar_permissoes_campanhas()', 'EXECUTE'),
      'Carimbos protegidos e reaplicar_permissoes_campanhas fora do alcance do app')
) as t(n, ok, teste)
order by n;
