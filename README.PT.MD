# Corch

Corch é um workflow reutilizável de desenvolvimento com IA para o Codex. Instale
suas skills e helpers em um repositório para dar ao Codex uma forma consistente
de delimitar solicitações, planejar mudanças, implementá-las, revisá-las e
verificar o resultado.

Mudanças pequenas e elegíveis ficam na conversa e no checkout atuais. Trabalho
que exige coordenação usa um backlog externo, um worktree Git preparado e funções
dedicadas de entrega. Você define o resultado desejado e autoriza as operações
pertinentes; o Corch preserva essas decisões durante a entrega.

[Read in English](README.md).

## Como funciona

O Corch tem três camadas:

- **Skills** descrevem as responsabilidades de cada função e como ela decide.
- **Helpers** preparam checkouts, mantêm o estado de execução e executam comandos
  com limites. Garantem regras mecânicas, como identidade e propriedade do checkout.
- **Configuração do projeto** seleciona repositório, provedor de backlog,
  comando de validação, preparação de dependências e runtimes das funções.

As especificações e o código do projeto adotante definem o comportamento do
produto. O provedor scrum externo mantém itens de backlog, prioridade, aceitação,
dependências e ciclo de vida. Registros locais ignorados pelo Git guardam o
contexto acordado e o estado de execução. Decisões diretas do usuário prevalecem
sobre o contexto registrado anteriormente.

### Entrega direta

Use `$corch-development-workflow` para uma nova solicitação de implementação sem
função atribuída. O router mantém o trabalho local quando o resultado é concreto,
localizado e verificável com padrões estabelecidos, com impacto pequeno e sem
família ativa ou necessidade de coordenação. Mudanças que afetam materialmente
segurança, privacidade, cobrança, dados de produção, contratos públicos,
infraestrutura, deploy ou dependências não se qualificam automaticamente.

Trabalho direto elegível não exige item de backlog, registro de tarefa, conversa
de função separada, worktree ou aprovação de plano. O Codex faz a mudança, executa
checks focados e informa o resultado na conversa atual. Exigências explícitas do
projeto e do usuário continuam válidas.

### Entrega coordenada

Uma **família de entrega** é o conjunto de conversas e registros locais
responsáveis por um item de trabalho. Seu fluxo normal é:

| Função | O que faz |
| --- | --- |
| Refinement | Verifica duplicatas no backlog externo e cria ou atualiza um item delimitado com critérios de aceitação e dependências. |
| Project Orchestrator | Verifica prontidão e responsabilidade, registra o contexto de entrega e prepara branch, worktree e dependências antes de iniciar o Planner. |
| Planner | Resolve o desenho com você e salva um plano Markdown de implementação para aprovação. |
| Worker | Continua do Planner aprovado no mesmo checkout, implementa a mudança, valida e conduz a entrega. |
| Reviewer | Verifica independentemente o candidato quanto a correção, simplicidade e riscos pertinentes. |
| Tester | Verifica independentemente a aceitação e escolhe, inspeciona, sanitiza e publica evidências adequadas dentro da autorização. |

O Worker gerencia Reviewer e Tester diretamente. As passagens iniciais ocorrem
nessa ordem, em conversas registradas separadas, com apenas uma usando o checkout
mutável por vez. Ambas são obrigatórias, salvo dispensa explícita de uma função
por você. Após correções, o Worker escolhe novas passagens conforme o comportamento
alterado e a incerteza restante; um commit novo sozinho não exige repetir todos
os checks.

Revisão e testes aceitam mudanças commitadas e não commitadas. Para trabalho não
commitado, as funções identificam tanto o conteúdo real quanto o HEAD que ancora
o checkout. Aprovação do plano e autorizações existentes são preservadas na
continuação e na recuperação.

## Configurar o Corch no seu projeto

### Requisitos

- Codex com acesso ao repositório de destino. A entrega coordenada também precisa
  de ferramentas para conversas de projeto e worktrees Git gerenciados.
- Node.js 22 ou superior e Git para os helpers.
- Ferramentas de build, gerenciador de pacotes e validação do próprio projeto.
- Acesso ao provedor scrum externo escolhido para a entrega coordenada normal.
  Jira tem um adaptador incluído; outros provedores exigem ferramentas conectadas
  adequadas.

Os helpers não têm dependências npm de execução. Adotar o Corch não exige copiar
o `package.json` deste toolkit nem instalar suas dependências de teste.
No Windows, o adaptador de comandos executa npm, pnpm e Corepack pelos launchers
Bash no PATH usando Git Bash. Defina `CORCH_BASH` com o caminho absoluto do
executável Git Bash se a descoberta automática não atender à sua instalação.

### Instalação

Abra uma conversa do Codex no checkout do Corch e indique a skill de origem e o
repositório de destino. Substitua estes caminhos pelos seus:

> Use a skill em `/caminho/corch/.agents/skills/corch-setup/SKILL.md` para instalar
> e configurar o Corch em `/caminho/meu-projeto`.

O setup inspeciona instruções, estado Git, CI, instalação existente e propriedade
de entregas ativas no destino. Copia as skills `corch-*` distribuídas, combina
as orientações de workflow no `AGENTS.md`, adiciona os ignores dos diretórios
operacionais e estabelece `.agents/workflow.json`. Preserva outras skills e
personalizações intencionais. Componentes compartilhados usados por uma entrega
ativa precisam aguardar.

O setup apresenta escolhas recomendadas e efetivas de modelo/esforço de raciocínio
e verifica disponibilidade quando possível. No Codex desktop, integra a preparação
de dependências ao ambiente local existente, respeitando a propriedade de arquivos
gerados. Executa a preparação e a validação aplicáveis ao projeto e informa o que
passou, o que foi omitido e o que permanece pendente.

A instalação local pode terminar antes de o acesso ao provedor estar pronto.
Isso não comprova prontidão para entrega coordenada. Os valores distribuídos
`example/project`, `TASK`, `main` e o comando de CI são exemplos a substituir
pelas configurações do projeto. Em uma instalação existente, invoque `$corch-setup`
para configurar ou reparar. Atualizações de versão são uma operação separada,
descrita adiante.

### Conversas persistentes opcionais

Peça ao setup para provisionar conversas persistentes se quiser pontos de entrada
dedicados:

> Use $corch-setup para configurar este projeto e criar as quatro conversas
> persistentes. Apresente as opções de runtime para que eu possa selecioná-las.

| Conversa | Objetivo | Chave de runtime |
| --- | --- | --- |
| Work Delegator | Entrada e encaminhamento pelo workflow de desenvolvimento. | `delegator` |
| Project Orchestrator | Responsabilidade, prontidão e coordenação de Planner/Worker. | `orchestrator` |
| Refinement | Escopo, aceitação e dependências no backlog. | `refinement` |
| Workflow Changer | Manutenção das skills e da configuração do Corch. | `workflow` |

O setup verifica e reutiliza conversas existentes, criando somente as ausentes.
Seus IDs ficam no arquivo ignorado `.agents/task-state/project-chats.json` do
checkout principal. Provisionar não cria uma família de item nem autoriza mensagens
entre conversas.

O encaminhamento vale em toda conversa do projeto. Quando uma discussão vira
pedido de backlog, como “transforme isso em uma tarefa”, o Corch usa o destino
Refinement registrado; a entrega coordenada selecionada vai ao Orchestrator.
Atribuições explícitas de função, instruções de trabalho local, famílias existentes
e autorização para mensagens são preservadas.

## Usar no dia a dia

Descreva o resultado, as restrições e as evidências esperadas. Exemplos úteis:

> Use $corch-development-workflow para corrigir o texto de ajuda deste comando e
> conferir se as opções documentadas correspondem à implementação. Mantenha a
> entrega local.

> Transforme esta ideia em um item de backlog com critérios de aceitação
> observáveis. Você pode enviar este pedido e o contexto acordado à conversa
> Refinement registrada.

> Use $corch-project-orchestrator para coordenar a entrega deste item refinado.
> Mantenha commits, pushes e publicação de PR pendentes até eu autorizá-los.

A skill da função nomeada se aplica quando essa função está atribuída. Uma família
aprovada continua da função existente, sem reiniciar a entrada ou o planejamento.

Espere um resultado delimitado com os resultados reais da validação, evidências,
achados pendentes e lacunas de cobertura. A entrega coordenada também produz
plano, resultados independentes ou dispensas explícitas e um handoff legível do
Worker. Um check omitido não é aprovado, e CI local aprovada não substitui as
funções independentes exigidas.

Edições locais não autorizam automaticamente commits, pushes, PRs, mensagens
externas, merge ou ações em produção. Operações exigidas precisam de autorização
para o destino específico, que o Corch reutiliza após recebê-la. Entrega apenas
local é um objetivo válido.

A PR normalmente é criada na prontidão local. Um rascunho anterior pode liberar
CI exclusiva de PR, preview ou ambiente de integração exigido, dentro da
autorização existente. Se um push da branch oferece a mesma validação, use-o.
Um rascunho não significa prontidão: checks exigidos devem cobrir o candidato
atual, e falhas precisam de correção demonstrada ou revisão do objetivo pelo
usuário. Checks ou operações de entrega exigidos e pendentes deixam a entrega
incompleta, com bloqueio concreto e próxima ação. Abrir uma PR sozinho não marca
um item de backlog como concluído.

## Personalizar o Corch conforme suas preferências

Coloque cada decisão no arquivo responsável por ela:

| O que você quer mudar | Onde mudar |
| --- | --- |
| Comportamento do produto e aceitação | Especificações do projeto e item do backlog externo. |
| Arquitetura, convenções de código, exigências de validação e orientações de autorização | `AGENTS.md` do projeto adotante e documentação canônica. |
| Repositório, branch base, prefixo interno, provedor, CI e preparação | `.agents/workflow.json`. |
| Modelos e esforço de raciocínio para futuras seleções de função | `.agents/workflow.json.runtimes`. |
| Responsabilidades de funções ou procedimento de entrega | O `.agents/skills/corch-*/SKILL.md` pertinente, mantendo os contratos compartilhados consistentes. |
| Mecânica de estado, execução ou preparação | `scripts/` e `references/contracts.md` do router, com testes apropriados. |

Por exemplo:

> Atualize o Corch para as convenções deste projeto. Use nosso comando de CI
> existente, preserve a aprovação do plano e recomende overrides de runtime que
> priorizem menor custo em implementações rotineiras. Verifique o suporte antes
> de salvar as escolhas.

### Configurações do projeto

Esta configuração ilustrativa descreve um projeto npm usando Jira. Substitua
repositório, URL, branch, prefixo, comandos e caminhos pelos seus valores reais:

```json
{
  "repository": "your-org/your-project",
  "baseBranch": "main",
  "issuePrefix": "TASK",
  "scrum": {
    "provider": "jira",
    "projectUrl": "https://your-site.atlassian.net/projects/PROJ"
  },
  "localCiCommand": "npm run verify:ci",
  "runtimes": {},
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

O campo de repositório atualmente aceita GitHub `owner/repo`; outros hosts Git
exigem uma mudança de compatibilidade. O prefixo interno pode diferir da chave
do provedor. As configurações do provedor selecionam o destino; credenciais ficam
na configuração de runtime. A ausência do provedor não seleciona um modo de
backlog local.

As etapas de preparação executam em ordem e usam um executável com argumentos
literais separados. Entradas e saídas são caminhos relativos ao repositório com
barras normais; escolha a política de scripts de ciclo de vida conforme o projeto.
Uma lista vazia de etapas é válida. O cache de setup considera comandos, entradas,
saídas e etapas anteriores.

`CORCH_CONFIG` seleciona uma configuração alternativa. Por padrão, os helpers
encontram a configuração junto à instalação, independentemente do diretório
atual do shell. Consulte o [contrato de configuração](.agents/skills/corch-development-workflow/references/contracts.md#project-configuration-and-setup)
para validação e integração de ambiente.

### Preferências de runtime

Mantenha padrões implícitos e salve somente overrides. Planner, Tester e as quatro
funções de conversas persistentes aceitam pares completos `model`/`reasoningEffort`.
Overrides de Worker usam as chaves `bounded`, `routine`, `standard`, `complex`,
`high-risk` ou `exceptional`. Reviewer aceita um par ou `"worker"`, seu padrão,
que acompanha o runtime salvo do Worker. Tester é resolvido separadamente dos
overrides do Worker.

Os padrões pertencem a [runtime-policy.mjs](.agents/skills/corch-development-workflow/scripts/lib/runtime-policy.mjs).
Use `$corch-setup` para inspecionar recomendações, verificar suporte no host e
salvar preferências. Edições de configuração afetam seleções futuras; não mudam
conversas existentes nem o snapshot de runtime salvo de um Worker. Pares sem
suporte precisam de correção explícita, sem substituição silenciosa.

### Mudanças no workflow

Faça edições pontuais na skill ou no helper responsável, preserve decisões
explícitas do usuário e propriedade ativa, e atualize o contrato compartilhado
quando sua interface mudar. Mantenha registros operacionais, transcrições,
credenciais e evidências fora da documentação pública. Se quiser omitir uma
função inicial obrigatória em uma entrega, declare a dispensa explicitamente
para que sua lacuna de cobertura seja registrada.

## Arquivos e registros locais

| Caminho | Responsabilidade |
| --- | --- |
| `AGENTS.md` | Instruções do projeto e encaminhamento de entrega. |
| `.agents/skills/corch-*` | Setup, funções de entrega e adaptador Jira. |
| `.agents/workflow.json` | Configuração do projeto. |
| `.agents/skills/corch-development-workflow/references/contracts.md` | Contratos compartilhados de estado, comandos e resultados. |
| `.agents/skills/corch-development-workflow/scripts/prepare-worker-worktree.mjs` | Preparação verificada do checkout e dependências. |
| `.agents/skills/corch-development-workflow/scripts/task-state.mjs` | Estado atômico, identidades, referências, leases de checkout e deduplicação de eventos. |
| `.agents/skills/corch-development-workflow/scripts/run-bounded-check.mjs` | Logs limitados e sanitizados de comandos e limpeza em interrupções. |
| `.codex/environments/environment.toml` | Preparação do ambiente local do Codex. |
| `tests/` | Testes do toolkit, separados dos requisitos de execução dos helpers. |

Trabalho coordenado usa registros ignorados `.agents/task-state/TASK-N.json`,
com o item externo em `workItem.scrum` e a entrada original em `sourceRef`.
Planos e handoffs usam `TASK-N-plan.md` e `TASK-N-handoff.md`; resultados das
funções e artefatos ficam em `.agents/evidence/`. `TASK-N` representa a chave
interna configurada. Novas branches coordenadas usam `corch/<chave>-<slug>`;
entrega direta pode usar `corch/<slug>` sem criar uma chave de tarefa.

## Validar ou desenvolver este toolkit

Neste checkout do Corch, com Node.js 22+, npm e Git:

```sh
npm ci --ignore-scripts
npm run verify:ci
```

`verify:ci` verifica formatação e executa testes. Use `npm test` somente para
testes, `npm run format` para formatar arquivos `.mjs`, ou `npm run format:check`
para conferir a formatação. Os testes usam dados e repositórios sintéticos
temporários sem credenciais de Jira/GitHub. Cobrem concorrência, identidade,
recuperação, runtimes, referências seguras, execução de comandos e instalação
copiada. Execute-os nos sistemas operacionais suportados; checks automáticos
não substituem observar uma entrega real no Codex.

O `.codex/hooks.json` local deste toolkit formata JavaScript em `SessionEnd`
usando o Prettier instalado. Revise e confie nele pela interface `/hooks` do
Codex antes de usar e inicie uma nova sessão para carregá-lo. Tem timeout de
três segundos; use `npm run format` se a formatação automática falhar. O fim de
sessão é diferente do fim de uma resposta do assistente. O setup não copia esse
hook aos projetos adotantes, e o Corch não instala hooks globais.

## Reparar, atualizar e recuperar

Use `$corch-setup` para instalação, configuração e reparos compatíveis.
Atualizações de versão ficam fora do escopo dessa skill. Antes de substituir
uma versão instalada, termine ou interrompa intencionalmente a entrega ativa;
não substitua skills e helpers compartilhados enquanto uma família depender deles.

Atualize skills e helpers distribuídos como um conjunto coerente, reconcilie
personalizações locais e siga os contratos atuais. Preserve configurações do
projeto, histórico operacional, checkouts, identidades, planos aprovados,
snapshots de runtime e eventos de entrega. Nunca copie estado ou credenciais
de outra instalação.

Ao atualizar cópias antigas, remova os helpers aposentados (`gate.mjs`,
`prepare-report.mjs`, `prepare-worker-bootstrap.mjs`,
`materialize-task-context.mjs`, `assess-delivery-preflight.mjs` e seus módulos
internos obsoletos) e a antiga skill `corch-delivery-coordinator`. Preserve
arquivos e hooks não relacionados. O setup trata a migração da chave antiga
`coordinator` de runtime/registro para `orchestrator`, preservando identidade
verificada da conversa e configurações; não mantenha as duas chaves de runtime.
Branches existentes de tarefa com `codex/` continuam legíveis.

Referências históricas de plano/resultados JSON continuam suportadas. Para
famílias inativas sem lease, restaure campos ausentes de contexto acordado e
entrega por `record-context` e `record-delivery`, começando na revisão 0 quando
ausentes. Verifique com `show` no checkout da família e resolva o item scrum
real antes de um novo despacho. Preserve os arquivos históricos em vez de
convertê-los ou apagá-los.

Na recuperação, inspecione a conversa e o checkout reais antes de repetir uma
criação ou envio ambíguo. Escritas de estado usam locks com PID/token: confirme
que o dono parou de escrever antes de remover somente um lock comprovadamente
abandonado. Não apague o JSON de estado nem limpe a lease de uma função para
reparar um lock de escrita. Encerre os processos iniciados para sua tarefa
quando ela terminar, preservando aqueles de outros trabalhos.

Consulte os [contratos compartilhados](.agents/skills/corch-development-workflow/references/contracts.md)
para detalhes de comandos, identidade do candidato, prontidão e recuperação.
