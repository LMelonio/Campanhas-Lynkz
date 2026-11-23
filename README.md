# LYNKZ Campanhas

App web (celular e computador, instalável) para **solicitar e aprovar campanhas promocionais** da
LYNKZ Distribuidora, com cadastro de empresas e balconistas. Versão **2.6.0**.

- Front-end: HTML, CSS e JavaScript puros (módulos ES), **sem build**. A pasta `public/` é o site.
- Banco e login: **Supabase** (PostgreSQL com RLS; regras de acesso no banco, não na tela).
- Hospedagem: **Cloudflare Workers** (arquivos estáticos) a partir deste repositório. Funciona em
  qualquer servidor web com HTTPS (modelo de nginx em `deploy/`).

| Quero… | Leia |
|---|---|
| Colocar no ar do zero ou atualizar o banco | `COMECE-AQUI.md` |
| Publicar (GitHub → Cloudflare), sair do Netlify, hospedar no servidor da empresa | `PUBLICAR.md` |
| Rodar os testes | `TESTES.md` |
| Mexer no código (arquitetura, regras, padrões) | `CLAUDE.md` |
| Saber o que mudou | `MUDANCAS-V2.md` |
| Entender quem vê quais dados pessoais | `PRIVACIDADE.md` |
| Trazer clientes do Qlik e as planilhas antigas | `QLIK-E-HISTORICO.md` |
| Segurança: o que está no código e o que configurar nos painéis | `SEGURANCA.md` |

```bash
npm run dev          # app local com banco simulado: http://localhost:8000/?papel=aprovador
npm test             # regras de negócio
npm run test:e2e     # navegador (instale antes: cd tests/e2e && npm install && npx playwright install chromium)
npm run test:banco   # banco (precisa de PostgreSQL local)
npm run qlik:simular # lê os clientes do Qlik sem gravar (precisa do .env)
```
