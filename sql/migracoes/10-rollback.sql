-- ============================================================
--  10 — ROLLBACK: desfaz as regras de segurança da 10.
--  Conta nova volta a entrar ATIVA (não recomendado). A tabela de
--  auditoria é apagada; exporte em CSV antes se quiser guardar.
-- ============================================================
begin;
create or replace function public.criar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (id, email, nome)
  values (new.id, new.email, split_part(new.email,'@',1))
  on conflict (id) do nothing;
  return new;
end $$;
alter table public.campanhas   drop constraint if exists campanhas_textos_tamanho;
alter table public.campanhas   drop constraint if exists campanhas_valores_faixa;
alter table public.empresas    drop constraint if exists empresas_textos_tamanho;
alter table public.balconistas drop constraint if exists balconistas_textos_tamanho;
do $$ begin
  if to_regclass('public.campanha_notas') is not null then
    alter table public.campanha_notas drop constraint if exists campanha_notas_tamanho;
    drop trigger if exists ao_limitar_notas on public.campanha_notas;
  end if;
end $$;
drop trigger if exists ao_limitar_campanhas on public.campanhas;
drop trigger if exists ao_limitar_empresas on public.empresas;
drop trigger if exists ao_limitar_balconistas on public.balconistas;
drop function if exists public.limitar_gravacoes();
drop trigger if exists ao_auditar_perfil on public.perfis;
drop function if exists public.auditar_perfil();
drop table if exists public.auditoria_perfis;
drop function if exists public.texto_ate(text, int);
commit;
