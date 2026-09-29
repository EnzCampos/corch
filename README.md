# Corch

Workflow reutilizável de desenvolvimento com IA para o Codex. Mudanças pontuais
elegíveis são entregues na conversa atual. O ciclo coordenado usa Refinement,
Coordinator, Planner e Worker, com Reviewer e Tester selecionados conforme o risco.
Três helpers cuidam da preparação, do estado e da execução de comandos.

O Worker decide quais revisões e testes independentes são necessários desde a
primeira passagem e após correções. As funções consideram o comportamento
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
2. **Coordinator** verifica o item, suas dependências e responsabilidades, registra os metadados e
   prepara o checkout compartilhado do Planner e do Worker.
3. **Planner** resolve o desenho com o usuário e salva o plano Markdown. A aprovação
   desse plano é preservada na continuação do Worker.
4. **Worker** implementa, valida o candidato e seleciona os checks independentes
   necessários, conforme sua skill. Quando ambos são selecionados, **Reviewer**
   revisa antes de **Tester** verificar o comportamento, no mesmo checkout.
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
verifica as alterações gravadas antes de entregar o item ao Coordinator.
Sem acesso ao provedor, o refinamento fica pendente com um bloqueio concreto;
um rascunho local não o substitui nem altera a elegibilidade da entrega direta.
Uma indisponibilidade não desfaz a autorização de uma implementação já em
andamento; a sincronização pendente deve ser informada.

Revisão e testes podem funcionar sem PR; checks que dependem de um preview ou
ambiente de integração usam o destino verificado para o commit atribuído.
Quando selecionado, o Tester escolhe, inspeciona, sanitiza e publica evidências
adequadas à aceitação, sem cotas de screenshots ou logs. Sem Tester, o Worker
preserva suas evidências de validação e identifica sua autoria. Um rascunho de PR
já pode receber evidências autorizadas. Se o destino ainda não existir, os
artefatos são salvos primeiro e publicados depois, sem repetir testes.
Uma falha de upload exige recuperação da publicação; não muda o resultado técnico.
Sem destino externo, links locais bastam. Fontes externas não autorizam publicação
automaticamente. Instruções e dispensas explícitas do usuário continuam válidas.

## Conteúdo

| Caminho | Responsabilidade |
| --- | --- |
| `AGENTS.md` | Instruções gerais do projeto |
| `.agents/skills/corch-*` | Skills das funções e adaptador para projetos que usam Jira |
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

1. Copie as skills de `.agents/skills/`, a configuração `.agents/workflow.json`
   e combine `AGENTS.md` com as regras do projeto. Para o Codex desktop, combine
   também `.codex/environments/environment.toml`. Preserve a configuração local.
2. Ajuste `repository` (`owner/repo`), `baseBranch`, `issuePrefix`, `localCiCommand`,
   `scrum.provider`, `scrum.projectUrl`, os passos de `setup` e, se necessário,
   `runtimes`. `example/project`, `TASK` e
   `main` são exemplos; não publique no destino distribuído como exemplo.
3. Ignore `.agents/task-state/` e `.agents/evidence/`. Não copie planos, logs,
   evidências, credenciais ou o estado de outro projeto. Mantenha a exclusão de
   `.agents/task-context/` se houver material histórico dessa versão anterior.
4. Os helpers usam somente Node.js e Git; não copie nosso `package.json` por cima
   do projeto nem instale dependências do toolkit para executá-los. As ferramentas
   de chats/worktrees e de publicação são usadas pelas skills, fora dos scripts.
5. Inicie com `$corch-development-workflow`, ou com a skill da função já atribuída.
   Use o ciclo existente para continuar um trabalho aprovado, sem reiniciar intake.

`scrum` seleciona o provedor e o projeto do backlog. Por exemplo:

```json
{
  "scrum": {
    "provider": "jira",
    "projectUrl": "https://tracker.example.test/projects/PROJ"
  }
}
```

O endereço acima é sintético. Os valores `null` da distribuição exigem resolver
o provedor/projeto selecionado pelo usuário antes de concluir Refinement; não
ativam um modo local. Use ferramentas conectadas ou o adaptador apropriado,
como `corch-jira-api` para Jira. Descubra campos, tipos, transições e relações
nativas no projeto selecionado. Credenciais ficam no ambiente de execução.
Configurar o destino não autoriza operações externas por si só.
O contrato compartilhado define as responsabilidades de cada função no provedor.

`CORCH_CONFIG` seleciona uma configuração alternativa. Fora disso, os helpers
encontram a configuração junto à instalação, independentemente do diretório do
comando. A preparação de dependências lê a configuração do checkout de destino.
Comandos de estado precisam apontar para o checkout da família; não copie um
estado antigo do checkout principal sobre decisões locais mais recentes.

Cada passo de setup declara executável, argumentos separados, entradas e saídas
relativas ao repositório. Exemplo para um projeto npm:

```json
{
  "setup": {
    "steps": [{
      "name": "install",
      "command": "npm",
      "args": ["ci"],
      "inputs": ["package.json", "package-lock.json"],
      "outputs": ["node_modules"]
    }]
  }
}
```

Uma lista vazia é válida. O cache considera comandos, entradas, saídas e passos
anteriores; falhas não marcam sucesso. Saídas ausentes e caminhos que escapam do
checkout impedem prontidão. A preparação explícita e a do ambiente compartilham
o lock/cache para evitar instalações concorrentes.

No Windows, os launchers Bash de `npm`, `pnpm` e `corepack` recebem argumentos
literais, incluindo espaços, aspas e caracteres de shell. O adaptador não monta
um comando CMD nem interpreta esses argumentos como código. A configuração de
shell dos scripts do projeto continua pertencendo ao projeto/gerenciador.
O caminho do checkout pode conter espaços.
Os checks têm prazo padrão de 180 segundos; `--timeout-ms` permite um prazo
adequado à suíte. Interrupção ou timeout encerra a árvore de processos iniciada
pelo comando, sem encerrar processos de outras tarefas.

## Runtime e recuperação

`runtimes` aceita pares `model`/`reasoningEffort` para Planner, Tester e
classificações do Worker. Reviewer também aceita `"worker"`. As rotas gravadas
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
