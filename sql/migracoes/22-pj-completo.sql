-- ============================================================
--  22 — PJ COM OS DADOS DE PAGAMENTO OBRIGATÓRIOS (v3.6.0)
--
--  Representante PJ ativo precisa de razão social, CNPJ ou CPF válido, chave
--  PIX e banco (sem eles não sai o recibo nem a ADP). Mesma regra e mesmas
--  mensagens da tela (errosPj() em public/js/lib/comissoes-documentos.js).
--  O gatilho só age quando a linha é criada ou alterada: os PJ incompletos
--  de hoje continuam ativos e pagando até alguém editar o cadastro.
--  Desativar um PJ incompleto (ativo = false) passa.
--  Roda depois de ao_preparar_comissionado (ordem alfabética), que já tirou
--  pontos do documento e espaços dos textos.
--
--  Pode rodar duas vezes. Pré-requisito: a 16 (e cnpj_valido da 07).
--  Desfazer: 22-rollback.sql. Depois: 22-validacao.sql.
-- ============================================================
create or replace function public.validar_pj_completo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.regime <> 'PJ' or not new.ativo then return new; end if;
  if btrim(coalesce(new.pj_razao_social, '')) = '' then
    raise exception 'Informe a razão social.';
  end if;
  if not (public.cpf_valido(coalesce(new.pj_documento, '')) or public.cnpj_valido(coalesce(new.pj_documento, ''))) then
    raise exception 'CNPJ ou CPF inválido.';
  end if;
  if btrim(coalesce(new.pj_pix, '')) = '' then
    raise exception 'Informe a chave PIX.';
  end if;
  if btrim(coalesce(new.pj_banco, '')) = '' then
    raise exception 'Informe o banco.';
  end if;
  return new;
end $$;
revoke execute on function public.validar_pj_completo() from public, anon, authenticated;
drop trigger if exists ao_validar_pj_completo on public.comissionados;
create trigger ao_validar_pj_completo before insert or update on public.comissionados
  for each row execute function public.validar_pj_completo();
