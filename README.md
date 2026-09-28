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
| `.agents/skills/corch-development-workflow/scripts` | Validação de contratos, bootstrap, estado, gates e preparação de evidências |
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
   de conversas/worktrees do Codex desktop. Confira os modelos indicados nas
   skills e nos runtimes de `workflow-lib.mjs`; adapte-os aos
   disponíveis no seu ambiente. As skills mantêm os termos dos contratos em inglês.

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
de `npm`, `pnpm` e `corepack` ficam restritos a tokens simples para evitar
interpretação de código pelo shell. Para argumentos complexos, use um script
Node executado com `node`.

## Fluxo de uso

Para uma alteração localizada, use `$corch-development-workflow`. Para trabalho
coordenado, use `$corch-refinement` para organizar a demanda e
`$corch-delivery-coordinator` para iniciar o item escolhido. O Coordinator prepara
a família, o Planner produz o plano e o Worker implementa e seleciona os gates
proporcionais ao risco.

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

`prepare-evidence.mjs` prepara o relatório e os metadados dos artefatos localmente.
A conversa e os arquivos ignorados de evidência bastam para a revisão. O script
não publica nada. Uma origem externa não é automaticamente um destino autorizado
de publicação. Em `prepare-pr-comment.mjs`, `--evidence-url` é opcional; use-o
apenas quando existir evidência publicada e verificada. Status externos também
são opcionais e seguem as capacidades da ferramenta escolhida.

Estado de tarefas, planos, logs, evidências, arquivos de ambiente e histórico de
outros repositórios não fazem parte do conteúdo distribuído.
