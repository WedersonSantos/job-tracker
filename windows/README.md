# Painel Windows do Job Tracker

O instalador Windows x64 0.3.6 inclui um painel de serviços e PostgreSQL privado. O atalho na área de trabalho inicia os serviços e abre o aplicativo no navegador padrão quando estiver pronto. A aba se chama JOB TRACKER. Mantenha o painel aberto durante o uso. Node.js, Visual C++ e WebView2 Runtime ausentes podem ser preparados pelo WinGet.

## Gerar o instalador

```powershell
npm run build:installer
npm run test:installer
```

Distribua `dist\installer-postgresql\JobTracker-Setup.exe`, seu SHA-256 e o relatório `release-manifest.json`. Não distribua a pasta inteira do projeto. O instalador contém código e recursos públicos, não configurações ou dados da sua instalação. Veja o [processo de distribuição](DISTRIBUICAO.md).

A janela inicial mostra somente a pasta de destino e **Baixar e instalar**. Ao iniciar, os controles são ocultados e a janela encolhe para mostrar a etapa, a barra e o percentual geral. Depois do sucesso, fecha automaticamente. Em caso de erro, volta a mostrar a pasta e **Tentar novamente**; **Mostrar detalhes** expande os registros.

A pasta sugerida é `%LOCALAPPDATA%\JobTracker\app`, e o botão **Escolher...** permite alterar o destino. Use uma pasta exclusiva e com permissão de escrita. PostgreSQL não é registrado como serviço global: o painel usa seus binários privados. Durante a preparação, os requisitos são conferidos e apenas os ausentes são baixados automaticamente. O Windows pode pedir autorização. O guia fica disponível em **Opções → Guia de uso** no aplicativo. **A validação completa em Windows limpo ainda é necessária antes da distribuição pública.**

O programa instala **Desinstalar Job Tracker.exe**, cria um atalho no menu Iniciar e registra a remoção nos Aplicativos instalados. Por padrão, preserva banco, anexos e configurações; apagar esses dados exige uma opção explícita e confirmação. Os requisitos compartilhados são mantidos. Remova a extensão pelo Chrome após desinstalar.

O [guia local](guide.html) explica o uso, a extensão, a privacidade e a configuração da API. Ele também é acessível pelo painel. A opção **Configurar API de IA** protege a chave Anthropic com DPAPI para o usuário Windows atual. Reinicie os serviços para aplicar uma alteração. Nenhuma chamada paga é feita para testar a chave ao salvar.

## Gerar e abrir

Na raiz do projeto, depois de instalar as dependências e configurar os arquivos `.env` conforme o README principal:

```powershell
npm run build:windows
npm run start:windows
```

Ou abra `dist\windows\JobTracker.exe` pelo Explorador. Mantenha o executável nesse local dentro do projeto. O build usa o compilador do .NET Framework do Windows e não exige instalar Electron.

## Usar

Os registros vêm abertos ao iniciar. O estado mostra **Iniciando API** e **Iniciando interface** durante a preparação e muda para ativo após a verificação. A conclusão não aguarda pipes de saída herdados pelos serviços, permitindo abrir o navegador e parar os serviços normalmente.

O desinstalador acompanha a remoção dos arquivos previstos, tenta novamente por até 20 segundos quando algum está em uso e fecha após a conferência final e o encerramento do processo de remoção. Em caso de pendências, mantém a janela aberta com o motivo. A pasta não precisa desaparecer quando contém dados preservados ou arquivos desconhecidos.

- **Iniciar**: prepara banco, API e interface; após concluir com sucesso, abre `http://127.0.0.1:3000` no navegador padrão. Isso também ocorre automaticamente ao abrir o atalho. Cancelamento ou falha não abre o navegador.
- **Abrir navegador**: abre novamente o aplicativo no navegador padrão.
- **Parar serviços**: funciona também durante a inicialização, aguarda a etapa segura atual, encerra os processos próprios e o banco da instalação e fecha o painel após confirmar a parada. Uma inicialização pendente não pode reabrir o aplicativo ou navegador. No Docker, só o contêiner da pasta exata é parado, sem excluir volumes nem desligar o Docker Desktop. Outros processos são mantidos.
- **Gerar extensão**: cria a pasta instalável e um ZIP em `dist\chrome`, com a versão do manifest. O pacote contém apenas os arquivos da extensão e suas instruções, sem currículos ou configurações locais.
- **Opções**: reúne configuração da API, guia, geração da extensão e registros. Também permite abrir o aplicativo dentro da janela, se preferir. **Abrir navegador** reabre o aplicativo no navegador padrão.
- **Abrir registros dos serviços**: mostra os arquivos de saída e erros em `dist\windows\runtime`. Esses logs são locais e podem conter mensagens dos serviços; não os publique sem revisão.

O banco fica em `data\postgresql`; os binários públicos ficam em `runtime\postgresql`. A conexão usa senha aleatória, autenticação SCRAM e somente `127.0.0.1`. Uma porta disponível entre 55432 e 55531 é escolhida na criação. Interface e API usam 3000 e 3333. O instalador pede Node.js 22+ e Visual C++ x64. A interface usa Webpack.

O desenvolvimento e instalações antigas com Docker preservam a configuração anterior. Não há conversão automática do banco legado: isso exige backup e migração explícita. O cluster nativo usa PostgreSQL 16; versões principais diferentes não são atualizadas automaticamente.

`npm run test:postgres` testa um banco sintético real: autenticação, loopback, migrations, API, reinício, desinstalação preservando dados e reinstalação. Requer o backend previamente compilado. Não migra nem copia o banco do desenvolvedor.

`npm run test:desktop` verifica um clique real em Parar durante a inicialização, a janela WebView2, o atalho `.lnk` em diretório isolado e o fechamento automático do desinstalador. A limpeza também verifica pastas vazias e saídas geradas pelo Prisma/TypeScript. Arquivos desconhecidos são preservados.

## Instalar a extensão no Chrome

1. Clique em **Gerar extensão**.
2. No perfil desejado do Chrome, abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor** e clique em **Carregar sem compactação**.
4. Selecione a pasta `dist\chrome\job-tracker-chrome-VERSÃO`, que contém `manifest.json`.
5. Abra o Job Tracker no mesmo perfil e use **Preencher formulário**.

O ZIP é para transporte e precisa ser extraído antes de carregar. Preserve a pasta instalada. Para atualizar na mesma pasta, gere e clique em **Recarregar** no Chrome. Quando a versão gerar uma nova pasta, remova a instalação anterior e carregue a nova. A instalação é manual por perfil; o painel não modifica perfis nem sessões do Chrome.

Para gerar apenas a extensão:

```powershell
npm run build:extension
```

## Verificar

```powershell
npm run test:windows
```

Verifica o ZIP, o conteúdo e suas dependências, geração repetida e o encerramento de processos em uma cópia isolada. Não instala a extensão em um perfil real.
