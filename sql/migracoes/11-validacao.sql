-- ============================================================
--  11 — VALIDAÇÃO (só leitura). Esperado: 3 linhas, todas com ok = true.
-- ============================================================
select n, ok, teste from (values
  (1, to_regprocedure('public.enviar_campanha(jsonb,jsonb,jsonb)') is not null,
      'função enviar_campanha existe'),
  (2, exists (select 1 from pg_proc where oid = to_regprocedure('public.enviar_campanha(jsonb,jsonb,jsonb)') and not prosecdef),
      'enviar_campanha é security invoker (policies e triggers continuam valendo)'),
  (3, to_regprocedure('public.enviar_campanha(jsonb,jsonb,jsonb)') is not null
      and has_function_privilege('authenticated', 'public.enviar_campanha(jsonb,jsonb,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.enviar_campanha(jsonb,jsonb,jsonb)', 'execute'),
      'só usuário logado executa')
) t(n, ok, teste) order by n;
