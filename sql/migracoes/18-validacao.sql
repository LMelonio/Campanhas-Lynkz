-- ============================================================
--  18 — VALIDAÇÃO (só leitura). Esperado: 7 linhas, todas com ok = true.
--  Rode DEPOIS de 18-excluir-balconista.sql. Linhas false = a migração não entrou.
-- ============================================================
select n, ok, teste from (values
  (1, to_regclass('public.balconistas_excluidos') is not null,
      'tabela balconistas_excluidos existe'),
  (2, coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.balconistas_excluidos')), false),
      'balconistas_excluidos com RLS ligada'),
  (3, exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'balconistas_excluidos' and cmd = 'SELECT')
      and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'balconistas_excluidos' and cmd <> 'SELECT'),
      'balconistas_excluidos só com policy de leitura'),
  (4, to_regprocedure('public.excluir_balconista(bigint,text)') is not null
      and coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.excluir_balconista(bigint,text)')), false),
      'função excluir_balconista existe (security definer)'),
  (5, to_regprocedure('public.excluir_balconista(bigint,text)') is not null
      and has_function_privilege('authenticated', 'public.excluir_balconista(bigint,text)', 'execute')
      and not has_function_privilege('anon', 'public.excluir_balconista(bigint,text)', 'execute'),
      'só usuário logado chama a função (a regra de administrador fica dentro dela)'),
  (6, not has_table_privilege('authenticated', 'public.balconistas', 'delete'),
      'app continua sem DELETE direto na tabela balconistas'),
  (7, to_regclass('public.balconistas_excluidos') is not null
      and not has_table_privilege('authenticated', 'public.balconistas_excluidos', 'insert')
      and not has_table_privilege('authenticated', 'public.balconistas_excluidos', 'update')
      and not has_table_privilege('authenticated', 'public.balconistas_excluidos', 'delete'),
      'registro das exclusões não pode ser alterado pela API')
) t(n, ok, teste) order by n;
