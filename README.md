# Corch

Workflow reutilizável de desenvolvimento com IA para o Codex. Mudanças pontuais
elegíveis são entregues na conversa atual. O ciclo coordenado usa Refinement,
Project Orchestrator, Planner e Worker, com Reviewer e Tester independentes.
Três helpers cuidam da preparação, do estado e da execução de comandos.

O ciclo coordenado exige uma primeira passagem de Reviewer e Tester, salvo
dispensa explícita do usuário. O Worker define o foco e decide quais novas
passagens são necessárias após correções. As funções consideram o comportamento
alterado e as evidências; os scripts preservam identidade, concorrência e execução segura.

O [router](.agents/skills/corch-development-workflow/SKILL.md) define a
elegibilidade da entrega direta: resultado localizado e verificável com padrões
conhecidos, sem necessidade de coordenação, família ativa ou risco material.
Quando esses critérios são atendidos, não é preciso pedir um modo especial,
criar item no backlog ou abrir outras conversas. A validação é focada e preserva
exigências explícitas do usuário e do projeto. Trabalho fora desses critérios
segue o ciclo coordenado, salvo instrução direta do usuário.

## Ciclo de entrega

1. **Refinement** consulta o backlog do provedor scrum externo, verifica duplicatas
   e cria ou atualiza o item com resultado, critérios de aceitação e dependências.
   Conversas e documentos podem iniciar a solicitação; o item refinado fica no provedor.
2. **Orchestrator** verifica o item, suas dependências e responsabilidades, registra os metadados e
   prepara o worktree, a branch e as dependências antes de iniciar o Planner.
   Depois cria o Planner com a atribuição completa e registra sua identidade e checkout,
   sem uma conversa intermediária de confirmação de prontidão.
3. **Planner** começa o planejamento no primeiro turno com o checkout já preparado,
   resolve o desenho com o usuário e salva o plano Markdown. A aprovação
   desse plano é preservada na continuação do Worker.
4. **Worker** implementa, valida o candidato e executa as passagens independentes
   iniciais, salvo dispensa explícita do usuário. **Reviewer**
   revisa antes de **Tester** verificar o comportamento, no mesmo checkout.
   Essas conversas também recebem a atribuição na criação e começam a passagem
   no primeiro turno, após confirmar registro e lease.
   O Worker cria ou reutiliza essas conversas, registra, atribui, acompanha e
   recupera as passagens diretamente, sem pedir ao Orchestrator que as gerencie.
5. Após correções, o Worker escolhe as novas passagens necessárias e explica como
   resolveu os achados. Um commit novo não obriga a repetir todas as funções.
6. A PR normalmente é criada na prontidão local. Um rascunho pode ser aberto antes
   quando libera uma validação necessária, como CI exclusiva de PR, preview ou
   ambiente de integração. Se um push da branch já oferece essa validação, basta
   usá-lo. A abertura do rascunho usa a autorização existente e não declara
   prontidão: validações exigidas, inclusive CI do commit atual, precisam estar
   concluídas ou explicitamente dispensadas. Falhas observadas exigem correção
   demonstrada ou revisão do alvo pelo usuário antes da entrega para revisão humana.
   O Worker vincula a PR ao item scrum e mantém as transições autorizadas do projeto.

O provedor scrum mantém o backlog, a prioridade e o ciclo de vida dos itens.
O registro local mantém o contexto acordado e o estado de execução; decisões
diretas do usuário prevalecem sobre conteúdo anterior do provedor. Refinement
verifica as alterações gravadas antes de entregar o item ao Orchestrator.
Sem acesso ao provedor, o refinamento fica pendente com um bloqueio concreto;
um rascunho local não o substitui nem altera a elegibilidade da entrega direta.
Uma indisponibilidade não desfaz a autorização de uma implementação já em
andamento; a sincronização pendente deve ser informada.

Revisão e testes podem funcionar sem commit novo ou PR. Para mudanças não
commitadas, o SHA de HEAD ancora o checkout; as funções identificam também o
conteúdo efetivamente revisado/testado, incluindo mudanças staged, unstaged e
arquivos novos relevantes. Uma restrição a commits não impede essas passagens.
Checks que dependem de um preview ou
ambiente de integração usam o destino verificado para o commit atribuído.
O Tester escolhe, inspeciona, sanitiza e publica evidências
adequadas à aceitação, sem cotas de screenshots ou logs. Quando o usuário dispensa o Tester, o Worker
preserva suas evidências de validação e identifica sua autoria. Um rascunho de PR
já pode receber evidências autorizadas. Se o destino ainda não existir, os
artefatos são salvos primeiro e publicados depois, sem repetir testes.
Uma falha de upload exige recuperação da publicação; não muda o resultado técnico.
Sem destino externo, links locais bastam. Fontes externas não autorizam publicação
automaticamente. Instruções e dispensas explícitas do usuário continuam válidas.

Checks locais aprovados não encerram a entrega coordenada. Antes de declarar
prontidão para revisão humana, o Worker conclui as funções independentes exigidas,
resolve lacunas de aceitação e executa commit, push, PR, evidências e atualizações
scrum exigidos pela entrega e já autorizados. Etapas exigidas pendentes ou sem
autorização deixam a entrega incompleta, com bloqueio e próxima ação explícitos.
Uma entrega acordada como local não exige publicação externa.

## Conteúdo

| Caminho | Responsabilidade |
| --- | --- |
| `AGENTS.md` | Instruções gerais do projeto |
| `.agents/skills/corch-*` | Skill de setup, funções de entrega e adaptador para projetos que usam Jira |
| `.agents/skills/corch-development-workflow/scripts/prepare-worker-worktree.mjs` | Preparação verificada do checkout e dependências |
| `.agents/skills/corch-development-workflow/scripts/task-state.mjs` | Estado atômico, identidades, referências, leases e deduplicação |
| `.agents/skills/corch-development-workflow/scripts/run-bounded-check.mjs` | Comandos com logs limitados e sanitizados e limpeza em interrupções |
| `.agents/skills/corch-development-workflow/scripts/lib/` | Configuração, runtime, validações mecânicas e execução compartilhada |
| `.agents/skills/corch-development-workflow/references/contracts.md` | Campos do registro, comandos e resultado comum |
| `.agents/workflow.json` | Configuração do projeto adotante |
| `.codex/environments/environment.toml` | Preparação do ambiente local do Codex |
| `tests/` | Testes do toolkit; não são dependências de execução dos helpers |

Os novos trabalhos coordenados vinculam o item externo em `workItem.scrum` no
registro `.agents/task-state/TASK-N.json`, preservando a entrada original em `sourceRef`.
O identificador interno pode diferir do identificador do provedor. Usam o plano
`TASK-N-plan.md` e resultados Markdown em `.agents/evidence/`. O Worker mantém o
handoff legível em `TASK-N-handoff.md`. Esses arquivos são locais e ignorados pelo
Git. Não há geradores de prompts, relatórios, packets de bootstrap ou amendments.
O Corch não registra hooks globais.

Branches de trabalho coordenado usam `corch/<chave>-<slug>`; a entrega direta
pode usar `corch/<slug>` sem criar uma chave de item. A pasta
`.codex/environments/` mantém o nome exigido pela integração de ambientes locais
do Codex; links `codex://` também preservam o protocolo do aplicativo.

## Validar esta cópia

Requisitos: Node.js 22 ou superior, npm e Git.

Os helpers são escritos em Node.js e podem ser chamados pelo Bash, PowerShell
ou outro shell do projeto. No Windows, comandos npm, pnpm e Corepack exigem
Git Bash e o launcher Bash do gerenciador no PATH. O adaptador encontra o Bash
pela instalação do Git; `CORCH_BASH` permite indicar um caminho absoluto para
outra instalação do Git Bash. PowerShell não é um requisito.
As diferenças de execução e limpeza de processos por sistema operacional ficam
no adaptador de comandos. A [orientação de portabilidade](.agents/skills/corch-development-workflow/references/contracts.md#portable-command-execution)
define como manter helpers, setup e exemplos independentes do shell.

```sh
npm ci --ignore-scripts
npm run verify:ci
```

Os testes usam dados e repositórios sintéticos temporários, sem credenciais de
Jira/GitHub. Cobrem operações concorrentes, identidade de checkout, recuperação,
runtime, referências seguras, comandos e instalação copiada. A validação de
instruções não substitui a observação de uma entrega real com as ferramentas do
Codex. Execute a suíte nos sistemas operacionais utilizados pelo projeto.

## Adotar em outro projeto

Use a skill [corch-setup](.agents/skills/corch-setup/SKILL.md) para instalar,
configurar ou reparar o Corch. Ela inspeciona o projeto, preserva personalizações
e trabalhos ativos, combina as instruções, apresenta os modelos e esforços de
raciocínio recomendados por função e verifica a prontidão local. As escolhas usam
a política de runtime existente e preservam as preferências do projeto.

Quando solicitado, o setup também provisiona quatro conversas persistentes:
Work Delegator, Project Orchestrator, Refinement e Workflow
Changer. Resolve os modelos/esforços, obtém a seleção exigida pelo aplicativo,
reutiliza conversas verificadas e cria somente as ausentes no projeto local.
As identidades ficam em `.agents/task-state/project-chats.json`, ignorado pelo
Git no checkout principal. Isso não cria famílias, Planner/Worker ou permissões
para enviar mensagens entre conversas. Reexecuções preservam trabalhos ativos.
O encaminhamento vale para qualquer conversa do projeto: discutir uma ideia
localmente não transfere a responsabilidade de Refinement para essa conversa.
Quando o usuário pede para transformar a discussão em item de backlog, o router
usa o chat registrado, respeitando autorização para mensagens e instruções
explícitas para assumir a função ou executar o trabalho na conversa atual.

O destino ainda não precisa ter as skills. Em uma conversa aberta no checkout
do Corch, indique a skill de origem e o repositório de destino, por exemplo
(substitua os caminhos pelos seus):

> Use a skill em `/caminho/corch/.agents/skills/corch-setup/SKILL.md` para instalar
> e configurar o Corch no repositório `/caminho/meu-projeto`.

Em uma instalação existente, invoque `$corch-setup` para completar a configuração
ou reparar componentes compatíveis. Atualizações de versão ficam fora desse
fluxo. Os campos, comandos e regras de preparação estão no
[contrato de configuração e setup](.agents/skills/corch-development-workflow/references/contracts.md#project-configuration-and-setup).

O resultado informa alterações, checks executados e pendências de acesso ou
preparação. Uma configuração local concluída não comprova acesso ao provedor
scrum nem execução de checks omitidos. Depois, inicie com
`$corch-development-workflow` ou continue pela função já atribuída, preservando
planos e aprovações existentes.

## Runtime e recuperação

`runtimes` aceita pares `model`/`reasoningEffort` para Planner, Tester,
`delegator`, `orchestrator`, `refinement`, `workflow` e classificações do Worker.
Reviewer também aceita `"worker"`. Os quatro campos de conversas persistentes
selecionam o runtime na criação; não alteram conversas existentes automaticamente.
As rotas gravadas
são snapshots; editar a configuração não troca o modelo de um Worker em execução.
Os padrões continuam em `lib/runtime-policy.mjs`. O Codex valida disponibilidade;
uma rejeição precisa de correção explícita, sem substituição silenciosa.

As escritas de estado usam um lock `.json.lock` com PID/token. Leitura por `show`
continua disponível. Escritores concorrentes aguardam até cinco segundos; um lock
abandonado ou não verificável nunca é roubado automaticamente. Antes de remover
somente esse lock, confirme que seu dono não está escrevendo. Não remova o JSON
nem limpe a lease do Reviewer/Tester para resolver o lock de escrita.

O Worker só libera a lease depois de confirmar o término da função. Resultados
ambíguos de criar/enviar exigem inspeção do chat/evento antes de repetir, evitando
famílias e mensagens duplicadas. Nenhum resultado anterior vira aprovação de um
novo commit automaticamente.

## Atualizar uma instalação

Não substitua helpers e skills sob famílias em execução. Termine ou interrompa
intencionalmente o trabalho antes da atualização. Preserve históricos, checkouts,
identidades, snapshots de runtime, planos aprovados e eventos de entrega.
Branches existentes com prefixo `codex/` continuam aceitas; novas famílias usam
`corch/`, sem exigir renomear branches anteriores.

Em uma família inativa e sem lease, leia seu contexto/bootstrap anterior e grave
os campos correspondentes com `record-context` e `record-delivery`, começando
pela revisão 0 quando o campo ainda não existir. Confira `show` no checkout
correto. As referências antigas de plano e resultados JSON continuam legíveis;
os arquivos históricos não precisam ser apagados ou convertidos. A partir daí,
use o registro único e os resultados Markdown para novas passagens.
Resolva e registre o item scrum real antes de um novo despacho, preservando
planos e aprovações existentes. Configurações e registros antigos sem `scrum`
continuam legíveis; sua ausência não representa refinamento externo concluído.

Remova os helpers aposentados ao copiar esta versão: `gate.mjs`,
`prepare-report.mjs`, `prepare-worker-bootstrap.mjs`,
`materialize-task-context.mjs`, `assess-delivery-preflight.mjs` e seus módulos
internos antigos. Preserve apenas as skills/arquivos da distribuição atual e os
dados locais. Se existirem hooks de versões antigas, remova somente os comandos
do Corch, preservando hooks de outras ferramentas. Não há motor legado paralelo.
