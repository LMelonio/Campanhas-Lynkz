-- ============================================================
--  22 — VALIDAÇÃO (só leitura). Esperado: 3 linhas, todas com ok = true.
--  Rode DEPOIS de 22-pj-completo.sql. Linhas false = a migração não entrou.
-- ============================================================
select n, ok, teste from (values
  (1, to_regprocedure('public.validar_pj_completo()') is not null
      and coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.validar_pj_completo()')), false),
      'função validar_pj_completo existe (security definer)'),
  (2, exists (select 1 from pg_trigger where tgname = 'ao_validar_pj_completo' and tgrelid = to_regclass('public.comissionados') and not tgisinternal),
      'gatilho ligado em comissionados'),
  (3, to_regprocedure('public.validar_pj_completo()') is not null
      and not has_function_privilege('authenticated', 'public.validar_pj_completo()', 'execute'),
      'o app não chama a função direto')
) t(n, ok, teste) order by n;
