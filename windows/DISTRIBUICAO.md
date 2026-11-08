# Distribuição Windows

## O que está implementado

O instalador Windows x64 inclui PostgreSQL privado e dispensa Docker nas novas instalações. Ele contém código, painel e binários públicos do banco, verifica hashes, baixa dependências npm e gera a extensão no destino. O usuário escolhe uma pasta exclusiva. Node.js LTS e Visual C++ x64 ausentes podem ser preparados pelo WinGet após autorização.

O instalador não baixa o código de um servidor seu: o código já está embutido. Os downloads nesta etapa são as dependências npm. Para disponibilizá-lo por um link público, ainda é necessário publicar o artefato em um serviço de releases ou hospedagem HTTPS escolhido pelo responsável.

## Como impedir que sua instalação pessoal seja distribuída

- A lista de distribuição em `scripts/release-files.cjs` aceita apenas árvores de código e arquivos públicos específicos. Não copia toda a pasta do projeto.
- Arquivos `.env`, backups, PDFs, CSVs, logs, perfis Chrome, anexos, diretórios de dados, clientes gerados e caches ficam fora da lista. Testes e sua massa de dados também são excluídos.
- O empacotamento não consulta Postgres nem endpoints de perfis e não inclui seed de perfil. São copiadas apenas as migrations de estrutura existentes, sem dump de dados.
- Uma verificação de conteúdo bloqueia padrões conhecidos de chaves, documentos preenchidos, caminhos pessoais absolutos e identificadores pessoais de desenvolvimento. Não imprime o valor encontrado. Essa checagem complementa a lista permitida; não reconhece todo tipo possível de dado pessoal.
- Cada instalação gera credenciais, identificador e cluster PostgreSQL próprios. `data/postgresql` não é distribuído. A chave de IA começa ausente. Outra instalação nas portas da API/interface é recusada antes da consulta de perfis.
- A extensão é gerada localmente a partir do código público. Ela não contém currículo ou chave de IA no pacote. Depois de instalada e acionada pelo usuário, recebe dados do aplicativo local para preencher a candidatura.
- O instalador inclui um manifesto de hashes SHA-256 e confere todos os arquivos antes de gravar. Um relatório público e o checksum do executável ficam ao lado do instalador.

Esses controles são verificáveis, mas não constituem uma garantia absoluta de privacidade ou autenticidade. Um hash fornecido pelo mesmo canal de um arquivo adulterado não substitui assinatura digital. Revise alterações no código público e o relatório antes de cada release.

## Configurações do usuário

O painel salva a chave da Anthropic em `dist/windows/runtime/anthropic.key`, protegida por DPAPI com escopo CurrentUser. A chave é fornecida ao processo da API apenas na inicialização; não entra na linha de comando, na extensão ou no relatório da distribuição. A proteção não defende contra código malicioso executando no mesmo usuário Windows. As configurações de banco continuam em arquivos locais, numa pasta restrita ao usuário e ao sistema.

Uma reinstalação mantém `installation.json`, `.env`, dados e a chave protegida. O instalador pede para parar os serviços e fechar o painel antes de atualizar arquivos. O desinstalador preserva os dados por padrão; com exclusão, encerra e remove somente o banco privado desta instalação. Requisitos compartilhados são mantidos. Instalações antigas com Docker não são convertidas automaticamente.

## Preparar uma versão

1. Execute `npm run build:installer`.
2. Execute `npm run test:installer` e `npm run test:windows`. Os testes de instalador extraem em uma pasta temporária do projeto, criam configurações novas, geram a extensão e verificam preservação de credenciais. Não usam chaves reais ou copiam banco.
3. Revise `dist/installer-postgresql/release-manifest.json`. O pacote atual contém código e recursos públicos; revise novamente quando novos arquivos entrarem na lista.
4. Teste numa conta Windows ou máquina virtual limpa: instalação, download de dependências, criação de perfil sem dados anteriores, inicialização do banco, extensão num Chrome novo, configuração de chave própria e reinstalação. Essa validação completa ainda não foi feita nesta entrega.
5. Para distribuição pública, assine o executável com um certificado de assinatura de código obtido pelo responsável. O instalador gerado atualmente não é assinado. Não é necessário desativar a segurança do Windows.
6. Publique somente `JobTracker-Setup.exe`, `JobTracker-Setup.exe.sha256` e o relatório público num canal HTTPS de releases, com versão e notas. Hospedagem e assinatura dependem de contas e credenciais do responsável; não foram publicadas nesta entrega.

O desinstalador é instalado junto ao programa e registrado no Windows. A remoção usa a lista de arquivos instalada, valida os caminhos, não atravessa junções e mantém arquivos desconhecidos. A instalação e a desinstalação são mutuamente exclusivas para o usuário Windows atual. Os testes cobrem caminho com espaços e acentos, requisitos simulados, remoção com e sem dados, arquivo externo por junção e referência fora da pasta; não instalam nem removem pré-requisitos reais.

## Proveniência do PostgreSQL

`postgresql-runtime.json` fixa PostgreSQL 16.15 x64, URL HTTPS da EDB e SHA-256. `prepare-postgresql.ps1` verifica esse hash e extrai somente binários, bibliotecas, recursos e licenças públicos. Nenhum cluster local ou pgAdmin é incluído. O hash foi calculado no download HTTPS durante a preparação desta versão; não é anunciado como checksum assinado pelo fornecedor. Mudanças de versão exigem revisão da origem e do pin.

O teste real está em `npm run test:postgres`. Antes da distribuição ampla ainda são necessários Windows limpo, assinatura de código, atualização transacional e recuperação de instalação interrompida. A passagem de dados de versões Docker e a atualização entre versões principais do PostgreSQL exigem migração explícita.

## Janela integrada 0.3.6

A parada invalida a operação de inicialização e bloqueia abertura de links até concluir. Após a parada confirmada, o painel fecha. PostgreSQL nativo usa pg_ctl com espera; no desenvolvimento/legado Docker, o banco só recebe stop após validar o label da pasta do projeto. Nenhum volume é excluído e o Docker Desktop não é encerrado. Em instalações novas, se a faixa de portas preferida estiver reservada pelo Windows/Hyper-V, o sistema operacional escolhe uma porta disponível.

Para caminhos com acentos, apenas os componentes que precisam de alias 8.3 são encurtados. A expansão do alias precisa corresponder exatamente à pasta escolhida antes de criar ou abrir o banco; nomes ASCII semelhantes não podem redirecionar a instalação para outra pasta.

A leitura de currículo PDF é local, usando pdf-parse 2.4.5 em processo filho com 15 segundos e limite de memória do heap de 256 MB; o arquivo tem teto de 5 MB e a leitura é limitada a 20 páginas e 100 mil caracteres. Falhas nativas do parser ficam isoladas da API. O texto não é enviado a IA, não vai para os registros e não é incluído no instalador. Apenas campos e seções vazios são preenchidos para revisão; o PDF continua como anexo mesmo quando sua leitura falha. A gravação do currículo estruturado depende do botão Salvar. Não há OCR nesta entrega.

O instalador compacto mostra pasta e Baixar e instalar. Ao iniciar, esconde esses controles e reduz a janela ao andamento; os requisitos são conferidos e apenas os ausentes são preparados, sem checkbox. A barra usa sete etapas: validação, extração, requisitos, dependências, compilação compartilhada, cliente do banco e extensão/atalhos. Validação e extração usam bytes realmente processados; as demais etapas são confirmadas por execução bem-sucedida. Downloads sem percentual real usam atividade indeterminada, sem estimativas inventadas. O protocolo estruturado não pode indicar 100% antes da saída bem-sucedida do inicializador. A janela fecha após o sucesso. Falhas mantêm opção de tentar novamente e acesso aos registros, sem expandi-los por padrão.

O painel mantém os registros visíveis desde a abertura e distingue os estados de inicialização, atividade e parada. A espera pelo inicializador é limitada à saída do próprio processo, sem aguardar pipes herdados por serviços filhos. Isso evita manter o painel em inicialização após a mensagem de pronto e bloqueá-lo em tentativas de cancelamento. O pacote inclui explicitamente o favicon JT em SVG e ICO, sem ampliar a lista de recursos permitidos para arquivos pessoais.

O desinstalador confirma a ausência dos arquivos previstos antes de gravar um comprovante temporário de conclusão fora da instalação. A janela exige esse comprovante e a saída bem-sucedida do processo para fechar. Arquivos bloqueados recebem novas tentativas por até 20 segundos; falhas permanecem visíveis. Não se usa a ausência da pasta inteira como condição, pois dados preservados e arquivos desconhecidos devem permanecer.

O SDK Microsoft WebView2 é obtido do NuGet público, com versão e SHA-256 fixos em `prepare-webview.ps1`. Somente DLLs e licenças específicas são incluídas. O Runtime WebView2 compartilhado pode ser instalado pelo WinGet, com autorização, se estiver ausente. A sessão do aplicativo fica em `data/desktop-webview`, nunca no pacote de distribuição, e não copia o perfil Chrome. Os sites de candidaturas continuam no navegador externo com a extensão.

O atalho inicia os serviços e, após sucesso, abre `http://127.0.0.1:3000` pelo navegador padrão do Windows. O título da aba é JOB TRACKER. Cancelamento e falha não abrem o navegador. A janela integrada continua opcional no menu. Fechar o painel solicita parada segura. O cancelamento durante inicialização usa uma solicitação identificada por operação; não interrompe o `initdb` no meio. A limpeza do desinstalador inclui saídas geradas do Prisma/TypeScript e todas as pastas vazias conhecidas, mantendo arquivos desconhecidos. A janela de remoção fecha após sucesso. `test:desktop` cobre os controles WinForms e WebView2 reais, sem alterar os atalhos reais do usuário.
