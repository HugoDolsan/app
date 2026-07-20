# Planejamento HD — app de tarefas (PWA)

App local-first para o celular, com os dados da planilha **Planejamento_Tarefas_HD1_2025** já carregados (169 tarefas, 31 projetos). Tela 1 = calendário mensal com barras das tarefas; tela 2 = tabela editável como no Sheets.

## Testar agora no computador

Abra o arquivo `index.html` com dois cliques (funciona direto no navegador; só o modo offline/instalação exige o site publicado).

## Publicar no Vercel (grátis, ~5 min)

1. Crie conta em https://vercel.com (pode entrar com o Google).
2. Na tela inicial, arraste a **pasta `app` inteira** para a área "Deploy" (ou Add New → Project → Deploy without Git → upload da pasta).
3. Ao final ele mostra a URL do site (algo como `planejamento-hd.vercel.app`).

## Instalar no celular

1. Abra a URL no Chrome do Android.
2. Menu ⋮ → **"Adicionar à tela inicial"** (ou "Instalar app").
3. Pronto: abre em tela cheia, funciona offline, dados ficam no aparelho.

## Atualizar o site — VS Code + GitHub (recomendado)

O repositório Git já está criado nesta pasta, com o primeiro commit pronto. Falta só publicar:

**Uma vez só:**
1. Instale: [VS Code](https://code.visualstudio.com) e [Git para Windows](https://git-scm.com/download/win) (Avançar até o fim nos dois). Tenha uma conta em [github.com](https://github.com).
2. VS Code → File → Open Folder → a pasta `app`.
3. Ícone **Source Control** (ramificação, na barra esquerda) → botão **Publish Branch** → entre com o GitHub quando pedir → escolha **private repository** com o nome sugerido.
4. No Vercel: projeto `planejamento_tarefas-hd` → **Settings → Git → Connect Git Repository** → selecione o repositório recém-criado (branch de produção: `main`).

**Depois, a cada mudança nos arquivos:**
VS Code → Source Control → escreva uma mensagem curta → **Commit** → **Sync Changes**. O Vercel publica sozinho em ~15 s, na mesma URL.

No navegador: Ctrl+F5. No celular (app instalado): feche e abra o app **duas vezes** — a primeira baixa a versão nova em segundo plano, a segunda abre atualizada. Seus dados não são afetados pelo deploy: ficam salvos no aparelho, fora do site.

*Alternativa sem GitHub: Vercel CLI (`npx vercel --prod` com Node.js instalado, ou dois cliques em `atualizar-vercel.bat` após o primeiro link). O arrastar-e-soltar não atualiza projeto existente — sempre cria um novo, com outra URL.*

## Ativar a sincronização com o Google Sheets (~10 min, uma vez só)

1. Abra a planilha no computador → **Extensões → Apps Script**.
2. Apague o que estiver no editor e cole todo o conteúdo de `apps-script.gs`. Salve.
3. **Implantar → Nova implantação → App da Web**:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
4. Autorize a conta quando pedir e copie a **URL /exec**.
5. No app: botão de sincronizar (canto superior direito) → cole a URL.

### Como sincronizar

- **⬆ Enviar para a planilha**: o app reescreve as linhas da aba Tarefas com o que está no celular. Só as colunas de *valores* são escritas — as colunas de fórmula (Projeto/Local/Categoria, Fim Planejado, Status, Gantt) são refeitas automaticamente, então tudo continua funcionando na planilha. Antes de cada envio é criada uma aba oculta `Tarefas_backup` por segurança.
- **⬇ Baixar da planilha**: substitui os dados do app pelos da planilha (para quando você editar no computador).
- A bolinha laranja no botão de sincronizar indica alterações locais ainda não enviadas.
- Regra prática: **edite em um lugar por vez** e sincronize ao trocar (o último envio vence).

## O que o app reproduz da planilha

- `Fim Planejado = WORKDAY(início, esforço)` (dias úteis)
- **% e Status funcionam como na planilha**: seguem a fórmula (⚙) até você digitar um valor por cima — aí o valor manual vence. Para voltar à fórmula: apague o campo % (deixe vazio) ou escolha "⚙ Automático" no Status. No envio, o Apps Script grava fórmula ou valor conforme o caso, célula por célula.
- Precisão da data: barras **Janela** (mais claras) e **Exata** (sólidas) no calendário
- **Conclusão** aparece nos cards do calendário (✔ verde), como marca ✓ no dia correspondente, e a tarefa entra na lista do dia/mês da sua conclusão

## Uso diário

- **Calendário**: toque num dia para filtrar a lista; toque numa barra ou card para editar; **+** cria tarefa já no dia selecionado; ‹ › muda o mês; toque no nome do mês volta para hoje.
- **Tabela**: toque no **número da linha** → adicionar acima/abaixo, duplicar, excluir. Um clique em **qualquer célula** abre a edição ali mesmo (Enter confirma, Esc cancela); Obs abre uma caixa maior. Filtros por status/projeto/busca valem para as duas telas.
- **Backup**: no painel de sincronização dá para salvar/restaurar um arquivo .json com tudo.
