-- ============================================================
--  17 — VALIDAÇÃO (só leitura). Esperado: 6 linhas, todas com ok = true.
-- ============================================================
select n, ok, teste from (values
  (1, to_regclass('public.comissao_premiacoes') is not null and to_regclass('public.comissao_ajustes') is not null
      and to_regclass('public.comissao_mes_pj') is not null and to_regclass('public.comissao_fechamentos') is not null,
      'tabelas de premiações, ajustes, dados do PJ no mês e histórico existem'),
  (2, (select bool_and(relrowsecurity) from pg_class where oid in ('public.comissao_premiacoes'::regclass,
        'public.comissao_ajustes'::regclass, 'public.comissao_mes_pj'::regclass, 'public.comissao_fechamentos'::regclass)),
      'RLS ligado nas quatro tabelas'),
  (3, not has_table_privilege('anon', 'public.comissao_premiacoes', 'select') and not has_table_privilege('anon', 'public.comissao_ajustes', 'select')
      and not has_table_privilege('anon', 'public.comissao_mes_pj', 'select') and not has_table_privilege('anon', 'public.comissao_fechamentos', 'select'),
      'visitante sem login não lê nada'),
  (4, not has_table_privilege('authenticated', 'public.comissao_premiacoes', 'delete') and not has_table_privilege('authenticated', 'public.comissao_ajustes', 'delete')
      and not has_table_privilege('authenticated', 'public.comissao_mes_pj', 'delete') and not has_table_privilege('authenticated', 'public.comissao_fechamentos', 'delete'),
      'ninguém apaga pela API (premiação e ajuste saem desativados; mês fechado é reaberto)'),
  (5, (select count(*) = 8 from pg_trigger where not tgisinternal and tgname in
        ('ao_preparar_comissao_premiacao', 'ao_preparar_comissao_ajuste', 'ao_preparar_comissao_mes_pj', 'ao_preparar_comissao_fechamento',
         'ao_auditar_comissao_premiacao', 'ao_auditar_comissao_ajuste', 'ao_auditar_comissao_mes_pj', 'ao_auditar_comissao_fechamento')),
      'triggers de preparo, trava do mês fechado e auditoria ligados'),
  (6, (select count(*) = 12 and bool_and(coalesce(qual, '') || coalesce(with_check, '') like '%eh_aprovador%')
         from pg_policies where schemaname = 'public' and tablename in ('comissao_premiacoes', 'comissao_ajustes', 'comissao_mes_pj', 'comissao_fechamentos')),
      'políticas só para administrador')
) t(n, ok, teste) order by n;
