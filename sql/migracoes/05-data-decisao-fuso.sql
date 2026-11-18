-- ============================================================
--  05 — DATA DA DECISÃO NO FUSO DO MARANHÃO
--
--  O banco do Supabase roda em UTC. Com current_date, uma campanha
--  decidida às 21h30 de 18/11 (horário de São Luís, UTC-3) era gravada
--  como 19/11. Agora a data é a do relógio de America/Fortaleza.
--
--  Só troca a função do trigger ao_decidir; as regras continuam iguais.
--  Não altera datas já gravadas. Para desfazer: 05-rollback.sql.
-- ============================================================
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
    new.data_decisao := (now() at time zone 'America/Fortaleza')::date;
    new.aprovador_nome := coalesce((select nome from perfis where id = auth.uid()), 'Aprovador');
    if new.status = 'Reprovada' and coalesce(trim(new.motivo),'') = '' then
      raise exception 'Reprova exige motivo.';
    end if;
  end if;
  return new;
end $$;
