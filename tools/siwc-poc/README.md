# Facts — agente financeiro SIWC local e ponte com o site

## Ponte Windows ↔ Facts App (11/11/2026)

O frontend Next.js usa Supabase para detectar a presença do agente e trocar **somente perguntas, histórico limitado e respostas transitórias** com o Windows. O processo local lê movimentos bancários por RLS e envia resumos agregados ao SIWC. Em consultas explícitas ao domínio, pode incluir também títulos e valores mínimos de fatos registrados (potencialmente pessoais). Tokens do ChatGPT nunca saem do Windows. Nenhuma porta local é publicada na internet.

- Tables: `facts_agent_presence`, `facts_agent_jobs`; RPC `facts_agent_heartbeat()`. RLS owner-only, expiração em 3 minutos e limpeza periódica via pg_cron. Aplicadas via SQL direcionado porque o histórico remoto de migrations diverge do checkout.
- Código local: `bridge.mjs`. Requer Node 26 (validado) com leitura nativa de TypeScript, Windows DPAPI e SDK local em `.siwc-devkit`.
- **Primeira configuração**, executada pelo usuário no PowerShell, dentro da pasta Facts App:

```powershell
npm run agent:login
npm run agent:status
node tools/siwc-poc/index.mjs status
npm run agent:start
```

O comando `agent:login` solicita e-mail e senha **do Facts/Supabase** no terminal interativo (senha oculta) e protege a sessão com DPAPI. **Digite o e-mail completo quando aparecer `E-mail do Facts:`; pressione Enter, depois digite a senha e pressione Enter novamente. A senha não aparece na tela.** Não usar senha do ChatGPT nesse comando. Para reautorizar o ChatGPT no SDK local, executar `node tools/siwc-poc/index.mjs login` com consentimento do usuário.

Se o login falhar, a CLI informa agora um diagnóstico limitado (e-mail malformado, senha vazia, credenciais rejeitadas, rede ou DPAPI) **sem revelar segredos**. Caso o erro seja de credenciais, valide que consegue entrar com as mesmas credenciais no site Facts e, se necessário, use a recuperação de senha do próprio site. Não cole senhas, links de autenticação nem tokens no chat.

A ponte permanece ativa enquanto o terminal `agent:start` estiver aberto e o computador acordado e conectado; Ctrl+C a encerra. **Inicialização automática do Windows ainda não foi configurada nem validada.** Com a ponte offline, dashboard, cartões, relatórios e sincronização remota continuam disponíveis no Facts. O usuário não deve enviar senhas ou tokens para o chat.

**Validação anterior:** migration SQL e permissões remotas conferidas; build, schema, SIWC, TypeScript e E2E em verde. Em 11/11, login DPAPI e conversa sintética pelo fluxo Supabase → Windows SIWC → Supabase confirmados (sem dados reais na pergunta). A expansão de consultas nativas abaixo tem testes e chamadas reais de leitura, mas a conversa ponta a ponta com **a versão expandida** só estará validada após reiniciar a ponte e testá-la.

### Consultas nativas de somente leitura (11/11/2026)

`read-only.mjs` seleciona operações pela intenção limitada da pergunta e consulta o próprio MCP Facts com o JWT da sessão Supabase do usuário. A lista permitida é estrita: `facts_get_report` (últimos 45 dias), `facts_list_documents` (contagem de metadados) e `facts_list_audit` (20 alterações recentes). Para diagnóstico, consulta também os **mesmos campos de leitura da Central de Conciliação**: última conciliação registrada, quantidade total de transações, última data de movimentação e revisões pendentes. Perguntas explícitas sobre uma categoria já presente no resumo bancário podem abrir até 30 movimentos `POSTED` desse recorte, com data, valor e descrição limitada. A equivalência **Vestuário → Clothing** foi confirmada nos rótulos reais da Pluggy; ela não implica correção da classificação. Nunca delega ao modelo comandos arbitrários, ferramentas de escrita, SQL, credenciais ou dados brutos de documentos.

O resultado é uma **consulta de estado e evidências do backend**: não equivale a interagir na UI, validar Pix, garantir atualização da Pluggy ou comparar extratos bancários originais. Um resultado `last_synced_at` não garante integração atualizada; relatórios de domínio e movimentações bancárias não devem ser somados sem conciliação. Se a leitura falhar, a resposta não deve declarar o teste como aprovado.

**Testes da expansão:** 72 Vitest + 9 schema + testes SIWC de leitura; chamadas MCP reais de relatório/documentos/auditoria e diagnóstico autenticado foram verificadas via Windows. Uma investigação real somente de leitura recuperou **13/13 transações** da categoria `Clothing` dos últimos 45 dias, sem reclassificar registros. A ponte existente na memória precisa ser reiniciada (Ctrl+C e `npm run agent:start`) para carregar as mudanças locais. **Não** foi configurado auto-start nem realizado novo deploy Vercel.

## Prova de conceito SIWC anterior

**Estado em 10/11/2026:** login Sign in with ChatGPT e inferência com o plano autorizados em teste real. A integração permanece **local**; não está implantada no Next.js/Vercel. Este diretório não altera o JARVIS, o banco de dados ou as movimentações bancárias.

## Componentes

- `index.mjs`: login, sessão, catálogo de modelos, prova mínima, interpretação de extrato e explicação de projeções.
- `dpapi.mjs`: armazenamento protegido com Windows DPAPI CurrentUser; sem tokens em Supabase, Vercel, Git ou logs.
- `snapshot.mjs`: seleção e validação de campos enviados ao modelo.
- `financial-core.mjs`: sugestões de correspondências entre contas e projeção determinística, sem chamadas de modelo.
- `financial-cli.mjs`: executor **offline** de previsão ou auditoria de possíveis transferências.
- `*.test.mjs`: isolamento por proprietário, bloqueio de saldos não verificados, calendário, recorrências, cenários e proteção DPAPI.

O SDK `@siwc/local` usado no teste vem do repositório oficial `openai/sign-in-with-chatgpt-devkit`, commit `0a36fefeb913055c8c7a1a29b63d82b96b2e841a`, compilado em `.siwc-devkit` (ignorados pelo Git). **Não** está declarado como dependência npm publicada. Não executar instalação em produção.

## Execução local

```powershell
npm run test:siwc
node tools/siwc-poc/index.mjs status
node tools/siwc-poc/index.mjs models
node tools/siwc-poc/index.mjs probe
```

`login` exige consentimento humano no navegador oficial, sem usar a sessão do JARVIS.

A rotina `analyze` recebe um resumo JSON de transações pelo stdin. A rotina `explain` recebe um cenário financeiro pelo stdin, calcula o resultado com `projectCash` e só então pede ao ChatGPT uma explicação. No caso de saldos ausentes/não verificados, retorna `status: unavailable` sem solicitar uma projeção ao modelo.

## Contrato mínimo para projeção (valores abaixo **fictícios**)

```json
{
  "currency": "BRL",
  "asOf": "2026-11-10",
  "through": "2026-12-31",
  "accounts": [
    {"id":"conta-a","balanceCents":200000,"balanceAsOf":"2026-11-10","balanceVerified":true},
    {"id":"conta-b","balanceCents":100000,"balanceAsOf":"2026-11-10","balanceVerified":true}
  ],
  "commitments": [
    {"id":"receita-teste","accountId":"conta-b","date":"2026-11-15","kind":"income","amountCents":500000,"confidence":"confirmed"},
    {"id":"despesa-teste","accountId":"conta-a","date":"2026-11-20","kind":"expense","amountCents":250000,"confidence":"confirmed","repeat":"monthly","until":"2026-12-20"}
  ]
}
```

`confirmed` significa compromisso confirmado como informação de planejamento, **não lançamento bancário POSTED**. `expected` designa valor incerto. `internal_transfer` exige origem/destino entre contas rastreadas. O resultado é **indicativo** e nunca promete conter todos os gastos futuros. Saldo de cada conta precisa estar explicitamente verificado na mesma data `asOf`; o extrato histórico não substitui isso. O horizonte máximo é de 730 dias.

Executar sem chamar IA:

```powershell
Get-Content .\cenario.json -Raw | node tools/siwc-poc/financial-cli.mjs forecast
```

Não gravar JSON financeiro real no repositório. Preferir conteúdo temporário via stdin e eliminar dados usados em testes conforme a política local.

## Verificações reais já realizadas

- OAuth com plano: `connected`, autorização `true`; catálogo de 8 modelos; inferência `FACTS-SIWC-OK` confirmada pelo usuário.
- Em 10/11, análise ChatGPT de 76 lançamentos POSTED de Mercado Pago e Itaú (01–20/10/2026). Valores e categorias confrontados com consultas somente de leitura.
- Em outubro/2026, 122 transações POSTED em quatro identificadores de conta históricos; o comparador encontrou 10 possíveis pares e **confirmou zero** automaticamente.
- Foram identificados 14 lançamentos de datas futuras marcados `PENDING`, total de R$ 2.703,63: **não são obrigações confirmadas**.
- O banco atual não dispõe de saldos bancários de referência nem de um registro geral de compromissos futuros. Não há projeção de saldo real homologada.

## Antes da integração ao produto

1. Obter **saldos verificados por conta com data de referência**, sem armazenar credenciais bancárias adicionais; tratar saldo disponível vs. contábil e limites de crédito separadamente.
2. Adicionar compromissos recorrentes com origem, autorizações, validade e distinção entre estimado/confirmado; não transformar automaticamente `PENDING` em obrigação.
3. Criar um adaptador local read-only autenticado no Facts (sem chave privilegiada no cliente), preservando o Supabase como fonte da verdade.
4. Validar cenários com mais de uma conta e todas as transferências, revisão humana de correspondências e atualização por conta; integrar interface e publicação somente sob autorização posterior.

**Nenhum login, análise ou execução desta PoC autoriza pagamentos, classificações ou movimentos automáticos.**
