-- ============================================================
--  10 — VALIDAÇÃO (só leitura). Esperado: 8 linhas, todas com ok = true.
-- ============================================================
select n, ok, teste from (values
  (1, position('false' in pg_get_functiondef('public.criar_perfil()'::regprocedure)) > 0,
      'Conta nova entra desativada'),
  (2, (select count(*) from pg_constraint where conname in
        ('campanhas_textos_tamanho','campanhas_valores_faixa','empresas_textos_tamanho','balconistas_textos_tamanho')) = 4,
      'Limites de tamanho e de valor'),
  (3, (select count(*) from pg_trigger where tgname in ('ao_limitar_campanhas','ao_limitar_empresas','ao_limitar_balconistas')) = 3,
      'Limite de gravações por hora'),
  (4, exists (select 1 from pg_trigger where tgname = 'ao_auditar_perfil'),
      'Auditoria de papel e ativo dos perfis'),
  (5, (select relrowsecurity from pg_class where oid = 'public.auditoria_perfis'::regclass),
      'Auditoria com RLS (só o aprovador lê)'),
  (6, not has_table_privilege('authenticated', 'public.auditoria_perfis', 'INSERT,UPDATE,DELETE'),
      'Ninguém grava na auditoria pelo app'),
  (7, not has_function_privilege('anon', 'public.eh_aprovador()', 'EXECUTE'),
      'Visitante sem login não executa funções de apoio'),
  (8, exists (select 1 from perfis where papel = 'aprovador' and ativo),
      'Existe pelo menos um aprovador (senão ninguém consegue aprovar)')
) t(n, ok, teste) order by n;
