# Corch

Workflow reutilizável de desenvolvimento com IA para o Codex: instruções de
agentes, skills por função, preparação de worktrees, planejamento, implementação,
revisão, testes e entrega com evidências.

Mudanças pequenas podem ser feitas diretamente na conversa atual. Entregas que
precisam de coordenação usam um contexto local e conversas por função. A demanda
pode vir da própria conversa, de um documento ou de ferramentas como GitHub
Issues, Linear e Jira. Nenhum gerenciador de tickets é obrigatório.
O usuário discute o plano com o Planner; após a aprovação, o Worker continua no
mesmo checkout. Reviewer e Tester usam esse checkout em sequência, com controle
de acesso para impedir alterações concorrentes.

## Conteúdo

| Caminho | Responsabilidade |
| --- | --- |
| `AGENTS.md` | Instruções gerais para o projeto |
| `.agents/skills/corch-*` | Router, Coordinator, Refinement, Planner, Worker, Reviewer, Tester e adaptador Jira |
| `.agents/skills/corch-development-workflow/scripts` | Nove helpers executáveis: oito centrais e preflight opcional |
| `.agents/skills/corch-development-workflow/scripts/lib` | Nove módulos internos, sem comandos executáveis |
| `.agents/skills/corch-development-workflow/references` | Contratos do workflow atual |
| `.codex/hooks.json` | Contexto de sessão e preparação do Planner |
| `.codex/environments/environment.toml` | Preparação do checkout pelo ambiente local |
| `.agents/workflow.json` | Configuração específica do projeto |
| `tests/` | Suíte de desenvolvimento do Corch, separada das skills |

As skills usam `.agents/skills/`, o caminho de descoberta documentado para
[skills locais](https://learn.chatgpt.com/docs/build-skills). A configuração
`workflow.json` e os diretórios de estado em `.agents/` são convenções do Corch.
Os [hooks](https://learn.chatgpt.com/docs/hooks) e o
[ambiente local](https://learn.chatgpt.com/docs/environments/local-environment)
permanecem em `.codex/` para serem reconhecidos pelo Codex.

## Validar esta cópia

Requisitos: Node.js 22 ou superior, npm e Git.

```sh
npm ci --ignore-scripts
npm test
```

Os testes usam repositórios e dados sintéticos temporários. Depois da instalação,
a suíte principal não precisa de credenciais ou acesso ao Jira/GitHub. O arquivo
de CI configura a suíte em Windows e Linux, com Node.js 22 e 24.

## Usar em outro projeto

1. Copie `.agents/` e combine `AGENTS.md` com as instruções existentes. Para a
   integração com o Codex, combine também os arquivos de `.codex/`. Preserve
   configurações locais ao combinar arquivos. Não copie o `package.json` sobre o
   do projeto: incorpore apenas os scripts e dependências de teste desejados.
2. Ajuste `.agents/workflow.json`: `repository` no formato `owner/repo`,
   `baseBranch`, `issuePrefix` e `localCiCommand`.
   `example/project` e `TASK` são exemplos; a origem da demanda fica em cada tarefa. O remote de
   entrega é derivado como `https://github.com/<repository>.git`.
3. Configure `setup.steps` com os comandos necessários ao projeto. A lista vazia
   é válida e não instala pacotes nem gera código.
4. Adicione ao `.gitignore` as entradas para `.agents/task-context/`,
   `.agents/task-state/` e `.agents/evidence/`. Confira os hooks antes de habilitá-los
   no Codex. O início de sessão é somente leitura; o hook do Planner e o ambiente
   local podem executar os passos de preparação configurados.
5. Para implementação com PR, conecte GitHub e disponibilize as ferramentas
   de conversas/worktrees do Codex desktop. Configure modelos e esforço em
   `workflow.json.runtimes`, conforme o ambiente. As skills mantêm os termos
   dos contratos em inglês.

`TASK-N`, `codex/task-n-<slug>`, `main` e `npm run verify:ci` nas instruções são
exemplos que seguem a configuração. A variável `CORCH_CONFIG` permite carregar
um arquivo alternativo; os passos de setup usam a configuração do checkout em
preparação. Credenciais devem permanecer fora de arquivos versionados.

Cada passo de setup declara `name`, `command`, `args`, `inputs` e `outputs`.
Exemplo para um projeto npm com lockfile:

```json
{
  "setup": {
    "steps": [
      {
        "name": "install",
        "command": "npm",
        "args": ["ci"],
        "inputs": ["package.json", "package-lock.json"],
        "outputs": ["node_modules"]
      }
    ]
  }
}
```

Os comandos rodam na raiz do checkout, com argumentos separados e caminhos
relativos ao repositório. O cache considera comandos, entradas, saídas e passos
anteriores; uma falha não marca o passo como concluído. No Windows, os argumentos
de `npm`, `pnpm` e `corepack`, tanto no setup quanto em `run-bounded-check.mjs`,
ficam restritos a letras ASCII, números e `@ . _ / : -`. Isso permite scripts
como `npm run verify:ci` e rejeita espaços, aspas, operadores e expansões do
shell nos argumentos. O diretório do checkout pode conter espaços. Para
argumentos complexos, use um script Node executado com `node`.

As mutações de `task-state.mjs` usam um lock exclusivo por arquivo de estado,
como `.agents/task-state/TASK-42.json.lock`, durante a leitura, validação e
gravação. Comandos concorrentes aguardam até cinco segundos; `show` continua
disponível sem adquirir o lock. O lock temporário registra PID e token do dono
e é distinto da lease de Reviewer/Tester gravada no JSON.

Se houver timeout, aguarde o comando dono terminar e tente novamente. Um lock
abandonado ou com dono não verificável nunca é removido automaticamente. Antes
de remover apenas o arquivo `.json.lock` indicado no erro, confira o PID e
confirme que nenhum comando `task-state.mjs` está escrevendo nesse estado.
Se não conseguir confirmar, preserve o lock. Não remova o JSON nem limpe a lease
do gate para resolver esse problema.

## Runtimes e gates

`runtimes` é opcional. `planner`, `tester` e cada classificação de `worker`
aceitam pares completos `model`/`reasoningEffort`. `reviewer` também aceita
`"worker"`, usando a rota gravada do Worker no momento da criação da conversa.
Exemplo de overrides parciais, sem alterar as outras classificações:

```json
{
  "runtimes": {
    "planner": { "model": "gpt-6-astra", "reasoningEffort": "xhigh" },
    "worker": { "complex": { "model": "gpt-5.6-sol", "reasoningEffort": "high" } },
    "reviewer": "worker",
    "tester": { "model": "gpt-6-luna", "reasoningEffort": "xhigh" }
  }
}
```

Sem overrides: Planner usa Astra/xhigh; Worker bounded/routine usa Luna/xhigh,
standard/complex usa Luna/max, high-risk usa GPT-5.6 Sol/high e exceptional usa
GPT-5.6 Sol/xhigh; Reviewer acompanha o Worker e Tester usa Luna/xhigh.
Os nomes completos dos modelos ficam em `lib/runtime-policy.mjs`. A validação local
confere a estrutura; o Codex valida disponibilidade e combinações de esforço.
Se rejeitar um runtime, corrija a configuração explicitamente, sem fallback.
Rotas já gravadas são snapshots: editar a configuração não as modifica nem invalida.

Grave a rota inicial uma vez com `task-state.mjs record-route`, informando
`--issue`, `--classification`, `--rationale` e os sinais relevantes em `--signal`.
Depois execute `prepare-worker-bootstrap.mjs --role planner --coordinator <id>`
com a identidade do bootstrap em stdin, sem montar `executionRoute` manualmente.
O helper lê o estado salvo em `--worktree` (por padrão, o diretório atual) e retorna
o objeto completo `bootstrap`, além do prompt e runtime. Salve esse objeto em
`.agents/task-state/TASK-N-bootstrap-input.json` antes de criar o Planner.
A preparação não grava arquivos; não é necessário um arquivo separado de rota.
O mesmo helper lê a rota salva para continuar o Worker após a aprovação do plano.

O Worker pode pedir escalada com evidência e encerrar o turno. O Coordinator
aguarda o término, confirma ausência de lease e executa `escalate-route` no checkout
do Worker com `--expected-revision`, `--classification`, `--signal` e `--rationale`.
A ordem é bounded/routine → standard/complex → high-risk → exceptional, sem redução
automática. O estado preserva revisões anteriores; rotas antigas começam na revisão 1.
O helper de continuação lê a rota atual e fornece o evento `worker-route:N` para
deduplicação. Após envio ambíguo, confira a conversa antes de reenviar. Continuam
válidos a aprovação, o checkout, o progresso e as validações concluídas.

Reviewer e Tester novos começam por `create_thread`, com histórico novo, no
projeto salvo correspondente e ambiente local. `gate.mjs dispatch` gera
os argumentos completos; seu contrato de entrada está no registro de contratos.
O Worker para de usar o checkout antes da criação. O primeiro comando do gate é
`claim-gate`, com seu ID validado pelo hook SessionStart e o caminho absoluto do
checkout do Worker. Esse comando registra a conversa e adquire a lease sob o
mesmo lock; uma falha não deixa registro parcial. Ausência de ID impede inspeção.
O diretório inicial da conversa pode ser o checkout principal: comandos, leituras,
estado e evidências sempre apontam explicitamente para o checkout do Worker.
Não há outro worktree, setup ou subagentes. Reviewer termina antes do Tester;
correções reutilizam cada conversa e seu modelo. Famílias já registradas continuam
válidas. O Worker só libera a lease depois de confirmar o término do gate.

## Fluxo de uso

Para uma alteração localizada, use `$corch-development-workflow`. Para trabalho
coordenado, use `$corch-refinement` para organizar a demanda e
`$corch-delivery-coordinator` para iniciar o item escolhido. O Coordinator prepara
a família, o Planner produz o plano e o Worker implementa e seleciona os gates
proporcionais ao risco.

Preflight é obrigatório somente quando o item selecionado ou sua vizinhança conhecida
contém relações hard ou de coordenação. Sem essas relações, o Coordinator também
dispensa o helper e o pacote. Permanecem as verificações de prontidão, conclusão,
capacidade, famílias ativas e responsabilidade. Quando houver dependências, preserve
a verificação dos vínculos, os bloqueios por milestone e os limites de concorrência.
Entrega direta continua sem pacotes de tarefa.

## Helpers e módulos internos

Há 18 arquivos `.mjs`: nove executáveis na raiz de `scripts/` e nove módulos em
`scripts/lib/`. Os oito helpers centrais são `workflow-hook.mjs`,
`prepare-worker-worktree.mjs`, `materialize-task-context.mjs`, `task-state.mjs`,
`run-bounded-check.mjs`, `prepare-worker-bootstrap.mjs`, `prepare-report.mjs` e
`gate.mjs`. O nono, `assess-delivery-preflight.mjs`, só se aplica às relações acima.

Os módulos internos são `lib/workflow-config.mjs`, `lib/runtime-policy.mjs`,
`lib/task-source.mjs`, `lib/validation.mjs`, `lib/bootstrap.mjs`,
`lib/delivery-state.mjs`, `lib/task-context.mjs`, `lib/gate-contracts.mjs` e
`lib/report.mjs`. Cada consumidor importa o responsável pela função; não há fachada.

`gate.mjs` reúne `selection`, `assess`, `compose` e `dispatch`; todos oferecem
`--help`. Assessment e composição usam `--gate review|test`. Na correção normal,
envie `delta: {impact, rationale, acceptanceFocus?, priorFindingIds?}` ao dispatch.
Ele calcula a topologia Git e incorpora a avaliação no pacote existente, sem criar
um documento intermediário. Uma avaliação completa fornecida é conferida contra
o Git. Use `assess` separadamente apenas para decidir sobre uma nova tentativa;
`compose` combina resultado-base e amendment e recusa sobrescrever uma saída.

As skills preservam decisões e autorizações explícitas do usuário. A aprovação
do plano de entrega identifica o destino e as ações externas incluídas. Merge,
produção e operações destrutivas precisam de autorização própria. O adaptador
REST Jira é opcional e só se aplica quando essa ferramenta for escolhida.
Publicar em qualquer serviço externo exige autorização para aquele destino.

## Entradas e entrega local

Cada demanda recebe uma chave interna estável, como `TASK-42`. Ela não precisa
ser o identificador de um ticket. No contexto normalizado, `issue.sourceRef`
registra a origem e pode ser:

- `null` para uma solicitação nesta conversa;
- uma URL HTTPS de GitHub Issues, Linear, Jira ou outro serviço;
- um caminho relativo, como `docs/proposta.md` ou `README.md`;
- uma referência `codex://threads/<id>` a outra conversa autorizada.

Não é necessário inventar URL, ID externo, tipo ou status para uma solicitação
local. O escopo, os critérios de aceitação e as decisões do usuário ficam no
contexto da tarefa. Dependências podem ser registradas e verificadas nesse
contexto, sem criar links em um tracker.

`prepare-report.mjs` valida o resultado e seus artefatos uma vez e retorna
`commentBody`, `marker`, `files` e `prComment` na mesma chamada. Use
`prComment.marker` e `prComment.body` para o resumo textual de uma PR autorizada.
O handoff final exige esse relatório; `gate.mjs selection` é apenas feedback
antecipado opcional, sem uma segunda validação obrigatória.
Review/test exigem `--profile`; handoff usa o perfil da seleção e rejeita divergências.
Evidência declarada inválida impede as duas saídas. A conversa e os arquivos
ignorados de evidência bastam para a revisão. O script não grava arquivos nem
publica nada. Uma origem externa não é automaticamente um destino autorizado
de publicação. `--evidence-url` é opcional; use-o apenas quando existir evidência
publicada e verificada. Status externos também são opcionais e seguem as
capacidades da ferramenta escolhida.

Estado de tarefas, planos, logs, evidências, arquivos de ambiente e histórico de
outros repositórios não fazem parte do conteúdo distribuído.
