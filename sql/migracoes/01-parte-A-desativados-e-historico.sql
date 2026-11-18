-- ============================================================
--  01 — PARTE A: usuários desativados, perfil e histórico
--
--  O que muda:
--  1. Usuário com ativo = false deixa de ler e criar campanhas e de ver
--     outros perfis (antes isso era só escondido na tela).
--  2. Ninguém consegue mais editar o próprio perfil pela API — era assim
--     que um desativado podia se reativar. O app nunca editava perfis;
--     a gerência continua editando pelo Table Editor do Supabase.
--  3. Aprovador só consegue mudar status e motivo (antes podia mudar
--     valores, nome do aprovador e data da decisão de qualquer campanha).
--     Depois de decidida, nem o motivo muda mais.
--  4. Coordenador não consegue mais gravar nome do aprovador, data de
--     decisão, motivo, código ou data de criação ao solicitar; o nome do
--     solicitante passa a ser carimbado pelo banco a partir do perfil.
--  5. Ninguém apaga nem esvazia (truncate) as tabelas pela API.
--
--  Não altera nenhuma linha de dados. Funciona com o app 1.3.0 e 1.3.1.
--  Tudo roda numa transação: se qualquer comando falhar, nada é aplicado.
--  Para desfazer: 01-parte-A-rollback.sql (rode antes o rollback da B,
--  se ela tiver sido aplicada).
-- ============================================================
begin;
-- Se alguém estiver usando a tabela e ela não liberar em 5 s, desiste sem
-- aplicar nada (em vez de ficar na fila travando o app de todo mundo).
set local lock_timeout = '5s';

-- ---------- quem está ativo ----------
create or replace function public.eh_ativo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = auth.uid() and ativo);
$$;
revoke execute on function public.eh_ativo() from public, anon;
grant  execute on function public.eh_ativo() to authenticated;

-- ---------- perfis ----------
-- O desativado ainda lê o próprio perfil (é isso que mostra a tela
-- "Acesso desativado"), mas não vê os outros.
drop policy if exists perfis_leitura on perfis;
create policy perfis_leitura on perfis
  for select to authenticated using (id = auth.uid() or public.eh_ativo());

drop policy if exists perfis_edita_proprio on perfis;

revoke all on public.perfis from anon;
revoke insert, update, delete, truncate on public.perfis from authenticated;

-- ---------- campanhas: regras de linha ----------
drop policy if exists campanhas_leitura on campanhas;
create policy campanhas_leitura on campanhas
  for select to authenticated using (public.eh_ativo());

drop policy if exists campanhas_solicita on campanhas;
create policy campanhas_solicita on campanhas
  for insert to authenticated
  with check (solicitante_id = auth.uid() and status = 'Pendente' and public.eh_ativo());

-- campanhas_decide fica como está: eh_aprovador() já exige ativo.

-- ---------- campanhas: permissões de coluna ----------
revoke all on public.campanhas from anon;
revoke insert, update, delete, truncate on public.campanhas from authenticated;

-- Decidir: só status e motivo.
grant update (status, motivo) on public.campanhas to authenticated;

-- Solicitar: todas as colunas, menos as que o banco carimba sozinho.
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'campanhas'
    and column_name not in ('id','codigo','criado_em','aprovador_nome','data_decisao','motivo');
  execute format('grant insert (%s) on public.campanhas to authenticated', cols);
end $$;

-- ---------- trava de integridade (decisão) ----------
create or replace function public.registrar_decisao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'Pendente' then
    if new.status <> old.status then
      raise exception 'Esta campanha já foi %. A decisão não pode ser alterada.', old.status;
    end if;
    if new.motivo is distinct from old.motivo then
      raise exception 'Esta campanha já foi %. O motivo não pode ser alterado.', old.status;
    end if;
  end if;
  if new.status <> old.status then
    new.data_decisao := current_date;
    new.aprovador_nome := coalesce((select nome from perfis where id = auth.uid()), 'Aprovador');
    if new.status = 'Reprovada' and coalesce(trim(new.motivo),'') = '' then
      raise exception 'Reprova exige motivo.';
    end if;
  end if;
  return new;
end $$;

-- ---------- carimbo da solicitação ----------
-- Nome do solicitante vem do perfil de quem está logado, não do app.
-- Inserções feitas pelo SQL Editor (sem usuário logado) ficam como vierem.
create or replace function public.carimbar_solicitacao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.solicitante_nome := coalesce((select nome from perfis where id = auth.uid()), new.solicitante_nome);
  end if;
  return new;
end $$;

drop trigger if exists ao_solicitar on campanhas;
create trigger ao_solicitar
  before insert on campanhas
  for each row execute function public.carimbar_solicitacao();

commit;
