-- ============================================================
--  01 — ROLLBACK DA PARTE A
--  Volta regras, permissões e trava ao estado do schema.sql anterior.
--  Não altera nenhuma linha de dados.
--
--  ATENÇÃO: se a parte B estiver aplicada, rode 02-parte-B-rollback.sql
--  ANTES deste arquivo.
-- ============================================================
begin;
-- Se alguém estiver usando a tabela e ela não liberar em 5 s, desiste sem
-- aplicar nada (em vez de ficar na fila travando o app de todo mundo).
set local lock_timeout = '5s';

drop trigger if exists ao_solicitar on campanhas;
drop function if exists public.carimbar_solicitacao();

create or replace function public.registrar_decisao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'Pendente' and new.status <> old.status then
    raise exception 'Esta campanha já foi %. A decisão não pode ser alterada.', old.status;
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

drop policy if exists perfis_leitura on perfis;
create policy perfis_leitura on perfis
  for select to authenticated using (true);

drop policy if exists perfis_edita_proprio on perfis;
create policy perfis_edita_proprio on perfis
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and papel = 'coordenador');

drop policy if exists campanhas_leitura on campanhas;
create policy campanhas_leitura on campanhas
  for select to authenticated using (true);

drop policy if exists campanhas_solicita on campanhas;
create policy campanhas_solicita on campanhas
  for insert to authenticated
  with check (solicitante_id = auth.uid() and status = 'Pendente');

-- Permissões padrão do Supabase (o "revoke all" também limpa as de coluna).
revoke all on public.campanhas, public.perfis from anon, authenticated;
grant  all on public.campanhas, public.perfis to   anon, authenticated;

drop function if exists public.eh_ativo();

commit;
