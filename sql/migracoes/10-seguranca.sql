-- ============================================================
--  10 — SEGURANÇA (v2.6.0)
--
--  1. Conta nova entra DESATIVADA. Antes, qualquer pessoa que criasse uma
--     conta pelo endereço público do Supabase virava coordenador ativo e
--     lia empresas e CPFs de balconistas. Agora a gerência libera:
--       update perfis set ativo = true, nome = 'Nome Sobrenome' where email = '...';
--     Quem já existe não muda.
--  2. Limites de tamanho nos textos e de faixa nos valores (evita gravação
--     de lixo gigante ou valores absurdos pela API). NOT VALID: não reprova
--     o que já está gravado, só o que for gravado daqui em diante.
--  3. Limite de gravações por pessoa por hora (campanhas, empresas,
--     balconistas, notas): para um script com a senha de alguém, não para
--     o uso normal.
--  4. Auditoria de perfis: toda mudança de papel ou ativo fica registrada
--     (quem, quando, de → para). Só o aprovador lê.
--  5. Funções de apoio sem acesso para visitante sem login (anon).
--
--  Só acrescenta regras. Não altera nem apaga dados. Pode rodar duas vezes.
--  Desfazer: 10-rollback.sql. Conferir: 10-validacao.sql.
-- ============================================================

-- ---------- 1. conta nova entra desativada ----------
create or replace function public.criar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (id, email, nome, ativo)
  values (new.id, new.email, split_part(new.email,'@',1), false)
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.criar_perfil() from public, anon, authenticated;

-- ---------- 2. limites de tamanho e de faixa ----------
create or replace function public.texto_ate(t text, n int)
returns boolean language sql immutable as $$ select t is null or char_length(t) <= n $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campanhas_textos_tamanho') then
    alter table public.campanhas add constraint campanhas_textos_tamanho check (
      texto_ate(cliente, 200) and texto_ate(laboratorio, 120) and texto_ate(campanha, 200)
      and texto_ate(tipo, 120) and texto_ate(mecanica, 2000) and texto_ate(observacoes, 2000)
      and texto_ate(motivo, 1000) and texto_ate(forma_pagamento, 60) and texto_ate(tipo_meta, 60)
      and texto_ate(rebate_base, 120) and texto_ate(rebate_gatilho, 120)
      and texto_ate(swile_nome_completo, 150) and texto_ate(swile_email, 254)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'campanhas_valores_faixa') then
    alter table public.campanhas add constraint campanhas_valores_faixa check (
      investimento_lynkz <= 10000000 and investimento_industria <= 10000000
      and meta <= 1000000000 and rebate_pct <= 100 and rebate_teto <= 10000000
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'empresas_textos_tamanho') then
    alter table public.empresas add constraint empresas_textos_tamanho check (
      texto_ate(nome, 200) and texto_ate(cidade, 120) and texto_ate(observacoes, 2000)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'balconistas_textos_tamanho') then
    alter table public.balconistas add constraint balconistas_textos_tamanho check (
      texto_ate(nome_completo, 150) and texto_ate(email, 254) and data_nascimento >= date '1900-01-01'
    ) not valid;
  end if;
  if to_regclass('public.campanha_notas') is not null
     and not exists (select 1 from pg_constraint where conname = 'campanha_notas_tamanho') then
    alter table public.campanha_notas add constraint campanha_notas_tamanho check (
      texto_ate(numero, 30) and texto_ate(serie, 10) and abs(valor) <= 1000000000
    ) not valid;
  end if;
end $$;

-- ---------- 3. limite de gravações por hora ----------
-- Só vale para usuário logado (auth.uid()). SQL Editor, cargas do Qlik e
-- das planilhas (service_role) não têm limite.
create or replace function public.limitar_gravacoes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n int; limite int;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'campanhas' then
    limite := 30;
    select count(*) into n from campanhas where solicitante_id = auth.uid() and criado_em > now() - interval '1 hour';
  elsif tg_table_name = 'empresas' then
    limite := 60;
    select count(*) into n from empresas where criado_por = auth.uid() and criado_em > now() - interval '1 hour';
  elsif tg_table_name = 'balconistas' then
    limite := 60;
    select count(*) into n from balconistas where criado_por = auth.uid() and criado_em > now() - interval '1 hour';
  elsif tg_table_name = 'campanha_notas' then
    limite := 300;
    select count(*) into n from campanha_notas where campanha_id = new.campanha_id;
  else
    return new;
  end if;
  if n >= limite then
    raise exception 'Muitos registros em pouco tempo. Aguarde e tente de novo, ou fale com a gerência.';
  end if;
  return new;
end $$;
revoke execute on function public.limitar_gravacoes() from public, anon, authenticated;

drop trigger if exists ao_limitar_campanhas on public.campanhas;
create trigger ao_limitar_campanhas before insert on public.campanhas for each row execute function public.limitar_gravacoes();
drop trigger if exists ao_limitar_empresas on public.empresas;
create trigger ao_limitar_empresas before insert on public.empresas for each row execute function public.limitar_gravacoes();
drop trigger if exists ao_limitar_balconistas on public.balconistas;
create trigger ao_limitar_balconistas before insert on public.balconistas for each row execute function public.limitar_gravacoes();
do $$ begin
  if to_regclass('public.campanha_notas') is not null then
    drop trigger if exists ao_limitar_notas on public.campanha_notas;
    create trigger ao_limitar_notas before insert on public.campanha_notas for each row execute function public.limitar_gravacoes();
  end if;
end $$;
create index if not exists idx_campanhas_solicitante_criado on public.campanhas (solicitante_id, criado_em);
create index if not exists idx_empresas_criado_por on public.empresas (criado_por, criado_em);
create index if not exists idx_balconistas_criado_por on public.balconistas (criado_por, criado_em);

-- ---------- 4. auditoria de perfis ----------
create table if not exists public.auditoria_perfis (
  id          bigint generated always as identity primary key,
  perfil_id   uuid not null,
  email       text,
  campo       text not null,
  de          text,
  para        text,
  feito_por   uuid,              -- null = SQL Editor / Table Editor do Supabase
  feito_em    timestamptz not null default now()
);
alter table public.auditoria_perfis enable row level security;
drop policy if exists auditoria_leitura on public.auditoria_perfis;
create policy auditoria_leitura on public.auditoria_perfis for select to authenticated using (public.eh_aprovador());
revoke all on public.auditoria_perfis from anon, authenticated;
grant select on public.auditoria_perfis to authenticated;

create or replace function public.auditar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.papel is distinct from old.papel then
    insert into auditoria_perfis (perfil_id, email, campo, de, para, feito_por) values (new.id, new.email, 'papel', old.papel, new.papel, auth.uid());
  end if;
  if new.ativo is distinct from old.ativo then
    insert into auditoria_perfis (perfil_id, email, campo, de, para, feito_por) values (new.id, new.email, 'ativo', old.ativo::text, new.ativo::text, auth.uid());
  end if;
  return new;
end $$;
revoke execute on function public.auditar_perfil() from public, anon, authenticated;
drop trigger if exists ao_auditar_perfil on public.perfis;
create trigger ao_auditar_perfil after update on public.perfis for each row execute function public.auditar_perfil();

-- ---------- 5. funções de apoio fora do alcance do visitante ----------
revoke execute on function public.eh_aprovador() from public, anon;
grant  execute on function public.eh_aprovador() to authenticated;
revoke execute on function public.registrar_decisao()    from public, anon, authenticated;
revoke execute on function public.carimbar_solicitacao() from public, anon, authenticated;
