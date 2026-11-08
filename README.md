# job-tracker

Rastreador pessoal de candidaturas a vagas de emprego. Encontra vagas, lê os
emails dos processos seletivos, ajuda a preencher formulários e mostra o que
acontece depois que você se candidata.

> **Roda só na sua máquina.** É um app para uma pessoa, sem login e sem
> deploy: você clona, sobe e usa em `127.0.0.1`. A API não tem autenticação
> de propósito, e isso só é seguro porque nada fica exposto na rede. Não
> publique num servidor. Mais em [Segurança](#segurança).

## Por que existe

O difícil de procurar emprego não é a ferramenta, é o atrito de registrar
cada candidatura. Se cadastrar uma vaga leva mais de trinta segundos, a
planilha é abandonada na terceira semana, e com ela a única forma de saber o
que está funcionando.

A ideia aqui é registrar sem digitar. A vaga vem da descoberta, a confirmação
de candidatura vem do email, e quando a empresa responde o Claude lê o email e
sugere o novo status. Você confirma com um clique.

## O que ele faz

| Funcionalidade | Precisa de chave da Anthropic? |
| --- | --- |
| Candidaturas: cadastro, status, histórico, busca, filtros e ordenação | não |
| Descoberta de vagas em Gupy, Greenhouse, Lever, Ashby, agregadores remotos, portais brasileiros e alertas do LinkedIn | não |
| Currículo estruturado, PDF pela impressão do navegador e versão congelada em cada candidatura | não |
| Preenchimento de formulário de candidatura no Chrome, parando antes do envio | não |
| Painel com funil, tempo até a primeira resposta e aproveitamento por fonte | não |
| Leitura dos emails do processo seletivo e vínculo com a candidatura certa | não |
| Sugestão de status a partir do email (recusa, entrevista, teste, proposta) | sim |
| "Resolver por IA": vincular ou criar candidaturas a partir de vários emails | sim |
| Extração de vaga a partir de um link | sim |
| Respostas para perguntas abertas de formulário, a partir do seu currículo | sim |

Sem a chave, tudo da primeira metade funciona. Com ela, o Claude entra só onde
você pede, e o que ele propõe passa pelo seu clique antes de virar dado.

## Requisitos para desenvolvimento

- **Node.js 20.9 ou mais novo** e npm
- **Docker**, para o Postgres
- **Google Chrome**, só se for usar o preenchimento de formulário
- Opcional: uma **chave da API da Anthropic** com crédito, e uma **conta do
  Gmail** para a leitura de emails

## Começando

```bash
git clone <url-deste-repositório> job-tracker
cd job-tracker
npm install
```

O `npm install` também gera o cliente do Prisma e compila o pacote
compartilhado.

Copie os arquivos de configuração. Os valores padrão já funcionam para rodar
localmente:

```bash
cp .env.example .env
cp recruiter-backend/.env.example recruiter-backend/.env
cp recruiter-frontend/.env.example recruiter-frontend/.env.local
```

Suba o banco e crie as tabelas:

```bash
npm run infra:up     # Postgres no Docker, escutando só em 127.0.0.1:5432
npm run db:deploy    # aplica as migrations
npm run db:seed      # cria o primeiro perfil (opcional: dá para criar pela tela)
```

Rode a API e as telas, cada uma num terminal:

```bash
npm run dev:worker   # API em http://127.0.0.1:3333
npm run dev:web      # telas em http://127.0.0.1:3000
```

Abra **http://127.0.0.1:3000**.

### Aplicativo Windows e extensão Chrome

Para gerar uma instalação nova para outra pessoa, execute `npm run build:installer`.
O arquivo `dist\installer-postgresql\JobTracker-Setup.exe` prepara a cópia do programa por
usuário e gera a extensão na máquina de destino. Não copie sua pasta de uso nem
seus arquivos `.env`. Veja [distribuição e privacidade](windows/DISTRIBUICAO.md).

Depois da configuração local, execute `npm run build:windows` e abra
`dist\windows\JobTracker.exe`. O painel permite iniciar os serviços, abrir a
aplicação no navegador e gerar a extensão do Chrome com **Gerar extensão**.
Para gerar apenas a extensão, execute `npm run build:extension`.

Novas instalações Windows incluem PostgreSQL privado e dispensam Docker;
Node.js, Visual C++ x64 e WebView2 podem ser preparados pelo instalador. O atalho
inicia o painel de serviços e abre as telas no navegador padrão quando estiverem prontas. Mantenha o painel aberto durante o uso. O desenvolvimento
mantém a configuração Docker. A extensão é carregada em `chrome://extensions`, pelo
modo de desenvolvedor. Veja [instruções do painel Windows](windows/README.md).

### Primeiros passos no app

1. **Escolha ou crie um perfil.** Perfil é só um seletor: dá para separar, por
   exemplo, "Backend" e "Tech Lead", cada um com seu currículo e suas
   candidaturas.
2. **Preencha o currículo** em *Currículo*, ou importe o arquivo de dados que o
   LinkedIn exporta (*Configurações → Privacidade de dados → Obter uma cópia
   dos seus dados*). O arquivo é lido na sua máquina e descartado.
3. **Procure vagas** em *Vagas*: ajuste os filtros, salve as que interessam e
   descarte o resto.
4. **Registre candidaturas** em *Candidaturas*, ou deixe que venham dos
   emails (veja abaixo).

A descoberta usa o campo **Local**, em **Currículo**, como cidade e estado do
perfil (por exemplo, `Uberlândia, MG`). Vagas presenciais ou híbridas em outra
cidade são descartadas quando a localização é reconhecida. Para presenciais,
é obrigatório confirmar uma cidade compatível: vagas sem cidade e perfis sem
cidade cadastrada não passam. Apenas o estado ou país não é suficiente.
Exigências explícitas
de residência na descrição e nos requisitos também são consideradas, mesmo
quando a vaga está marcada como remota. A sede da empresa em outra cidade, por
si só, não elimina uma vaga remota. Fora das presenciais, localização ausente ou ambígua continua
aparecendo: o filtro não calcula distâncias nem interpreta todo texto possível.

## Configuração opcional

Tudo abaixo fica em `recruiter-backend/.env`. Depois de mudar o arquivo,
reinicie a API.

### Claude (Anthropic)

```env
ANTHROPIC_API_KEY=sua-chave
```

A chave precisa de crédito: sem saldo, a API responde erro e a tela avisa.

Os modelos usados são o **Haiku** para ler vagas e emails e o **Sonnet** para
escrever respostas de formulário. O app só chama o Claude quando você pede
(um clique, uma seleção) ou ao sincronizar emails já vinculados a uma
candidatura. No uso pessoal, cada chamada custa frações de centavo de dólar.

O que sai da sua máquina:

- **Emails:** só os vinculados a uma candidatura e com remetente confirmado.
  A caixa de entrada nunca é enviada.
- **Currículo:** só a parte profissional, sem nome, contatos ou data de
  nascimento.
- **Vagas:** o texto da vaga que você está usando.

Texto escrito pelo Claude carrega a marca d'água estatística que a Anthropic
aplica desde agosto de 2026. Por isso as respostas de formulário vêm, por
padrão, como tópicos para você escrever.

### Email (Gmail)

A leitura usa um **rótulo** do Gmail, nunca a caixa de entrada inteira: o
próprio Gmail garante esse limite antes de o app ver qualquer email.

1. Ative a verificação em duas etapas na conta Google.
2. Gere uma **senha de app** em `myaccount.google.com/apppasswords`. Nunca use
   a senha principal da conta.
3. Crie o rótulo `job-tracker` e, em *Configurações → Marcadores*, marque
   **Mostrar no IMAP**. Sem isso o rótulo existe na web e fica invisível para
   o app.
4. Crie um filtro que aplique esse rótulo aos emails das plataformas de
   recrutamento. Use o domínio de onde o email **sai**, que nem sempre é o do
   site: a Gupy envia de `gupy.com.br`, o Greenhouse de `greenhouse-mail.io`,
   a InHire de `inhire.app`. Inclua `jobalerts-noreply@linkedin.com` para os
   alertas de vaga do LinkedIn entrarem na descoberta. Na dúvida, abra um
   email da plataforma e veja o remetente. Ao salvar, marque *Aplicar filtro
   também às conversas correspondentes*.
5. Preencha no `.env`:

   ```env
   IMAP_HOST=imap.gmail.com
   IMAP_USER=seu-email@gmail.com
   IMAP_PASSWORD=a-senha-de-app
   ```

A sincronização roda uma vez quando a API sobe e, depois disso, só quando você
clica em **Sincronizar agora** na tela *Emails*. Para trazer emails mais
antigos que o último sincronizado (depois de ampliar o filtro, por exemplo):

```bash
curl -X POST -H 'Content-Type: application/json' \
  'http://127.0.0.1:3333/emails/sync?days=45'
```

### Empresas acompanhadas na descoberta

Em **Vagas → Fontes da busca**, cole links ou identificadores de murais do
Greenhouse, Ashby e Lever, um por linha, e clique em **Validar e salvar murais**.
Murais inválidos impedem a gravação e preservam a lista anterior. A configuração
vale para todos os perfis e é aplicada nas próximas buscas, sem reiniciar.
Links do Ashby com `ashby_department_id` preservam o filtro de departamento ou
equipe. A página de carreiras da própria Ashby (`www.ashbyhq.com/careers`) também
é aceita. Um filtro desconhecido ou que não possa ser resolvido gera aviso,
em vez de ampliar silenciosamente a busca para todos os cargos.
Links do Lever com `team`, como `https://jobs.lever.co/empresa?team=Technology`,
também preservam a equipe selecionada, sem incluir os demais times.

**Testar configuração salva** consulta as fontes com o termo `python`, incluindo
os portais da busca ampliada. Mostra contagens antes dos filtros do perfil e
distingue fontes não configuradas, sem vagas, com erro e com resultado parcial.
O teste não sincroniza emails nem chama IA. A seção do LinkedIn indica quais
campos IMAP faltam e como concluir a configuração local, sem mostrar credenciais.

Os murais ficam em `~/.local/share/job-tracker/discovery-sources.json` (ou em
`XDG_DATA_HOME`). Antes da primeira gravação pela tela, o app usa os valores do
`.env` como configuração inicial. Exemplo de configuração manual:


```env
DISCOVERY_GREENHOUSE_BOARDS=empresa-um,empresa-dois
DISCOVERY_ASHBY_BOARDS=
DISCOVERY_LEVER_BOARDS=
```

O slug é a parte do endereço do board: `boards.greenhouse.io/<slug>`,
`jobs.ashbyhq.com/<slug>`, `jobs.lever.co/<slug>`. A tela valida a resposta do
mural, e erros posteriores aparecem no diagnóstico por fonte. Prefira
empresas com vagas remotas ou no Brasil: um board com centenas de vagas
presenciais no exterior enche a fila com o que você não procura.

**Pesquisa automática no navegador:** Jobbol, Solutis/InHire, Uberlândia
Inovadora e os murais Ashby/Lever configurados abrem o Chrome e interagem com
seus filtros. O navegador de pesquisa tem perfil próprio em
`~/.local/share/job-tracker/search-browser-profile/`, separado das candidaturas.
Os anexos HTML são referências para os seletores; não são o acervo da pesquisa.
Cada pesquisa sem cursor visita as fontes novamente. A paginação da mesma
pesquisa reaproveita o lote por até 15 minutos, separado por localização e
preferências, evitando repetir a navegação a cada página de resultados.

Antes de exibir cada lote, o programa consulta os links e exclui anúncios com
aviso explícito de encerramento, prazo `JobPosting.validThrough` vencido ou
resposta HTTP 404/410. Vagas removidas são substituídas por outros resultados
sem pular itens na paginação. A consulta tem concorrência limitada, prazo
de 20 segundos por lote e cache de 60 segundos. HTTP 403/429, CAPTCHA, falhas
de rede e páginas sem evidência suficiente aparecem como **Disponibilidade
não confirmada**, sem serem tratadas como vagas ativas ou encerradas.
No Glassdoor, a verificação tenta também ler a página no Chrome de pesquisa;
o identificador `jl` é preservado no link. Links colados para extração também
são recusados quando o HTML informa encerramento, antes de consultar a IA.
Essa verificação não remove vagas já salvas e não garante que uma vaga ainda
esteja aberta no momento de uma candidatura posterior.

- **Jobbol:** preenche cargo, seleciona a sugestão de cidade/UF, clica Buscar
  e aplica Home Office ou Híbrida quando solicitado. Remotas usam pesquisa
  nacional sem a cidade padrão do portal. Sem termo, usa o primeiro cargo
  configurado no perfil (ou desenvolvedor). Percorre até cinco páginas,
  remove propagandas e duplicatas e lê data e localização dos cartões.
- **Solutis:** preenche o nome da vaga e seleciona modalidade e localização
  quando disponíveis. Percorre o carregamento progressivo da lista. Os dados
  da resposta carregada pelo próprio navegador enriquecem somente os links
  exibidos após filtrar; não é uma segunda pesquisa independente por API.
- **Uberlândia Inovadora:** seleciona Vaga, pesquisa cargo/empresa/stack e
  seleciona as senioridades. Especialista corresponde a Sênior e Liderança a
  Lead no app. Entradas apenas com email ficam fora da importação.
- **Ashby/Lever:** seleciona departamento/equipe dos murais configurados e
  modalidade quando oferecida. A API enriquece somente as vagas que o navegador
  exibiu após os filtros. Continua sendo necessário configurar as empresas.

Filtros indisponíveis no site, país, regras de residência, salário e demais
preferências são conferidos no programa antes de mostrar as vagas. Campos
ausentes permanecem desconhecidos. Um CAPTCHA ou bloqueio é informado no
diagnóstico, nunca resolvido automaticamente nem tratado como zero vagas.
Quando o filtro restringe modalidades (por exemplo, apenas remotas ou apenas
presenciais), anúncios sem evidência de modalidade ficam fora da recomendação.
Título, localização e declarações explícitas sobre o trabalho na descrição e
nos requisitos complementam o campo estruturado. Presenciais exigem cidade
compatível com o currículo, incluindo a UF quando informada; só informar o
mesmo estado ou país não é suficiente. Menções genéricas de benefícios para
vários regimes não definem a modalidade da vaga.
A aba que pediu verificação fica aberta no Chrome de pesquisa para conclusão
manual e uma nova tentativa. As demais abas de pesquisa são fechadas ao terminar.

### Preenchimento de formulário

O botão **Preencher formulário** primeiro lista os perfis normais do Chrome
(por exemplo, Seu Chrome e Carlos). Ao escolher um deles, a vaga abre no
Chrome habitual; janelas já abertas desse perfil são reaproveitadas. O login
do Google acontece na sua sessão normal. Para preencher nessa mesma aba,
carregue uma vez a extensão local da pasta `chrome-extension/`, seguindo
`chrome-extension/LEIA-ME.md`. A extensão recebe os dados do pedido local
somente quando você escolhe a candidatura e clica em **Abrir formulário e preencher**.
O Chrome pede permissão opcional para sites HTTPS para acompanhar mudanças de
domínio entre o portal e a empresa. A extensão segue até quatro botões de
candidatura, incluindo **Candidatar-se no site da empresa**, e preenche ao
encontrar o formulário. Login e CAPTCHA ficam com você. O envio final é manual.
Pedidos expiram em dez minutos e são perdidos quando o backend reinicia.
Ela preenche campos reconhecidos e anexa o PDF quando identifica um único
campo de currículo; não envia a candidatura. Iframes externos não são cobertos
por esta primeira versão. A extensão precisa estar instalada no perfil escolhido.
No Google Forms, cada etapa é reconhecida independentemente de nome e email;
os títulos das perguntas e `aria-labelledby` identificam os campos. O nível de
inglês usa somente o idioma cadastrado e as opções de tecnologias usam somente
competências salvas no currículo. Perguntas sem resposta configurada ficam
para revisão. Continuar/Avançar/Próxima avançam automaticamente após conferir
campos obrigatórios e validações. Se precisar responder algo, complete e avance
manualmente: a extensão retoma na próxima etapa, mesmo em navegação sem mudança
de URL. O progresso autorizado é recuperável em `chrome.storage.session`, sem
guardar respostas ou PDF, e pode ser cancelado em Parar automação. Enviar,
Finalizar e outros controles de conclusão nunca são acionados automaticamente.

O preenchimento pela interface usa somente os perfis habituais e a extensão.
O fluxo assistido legado descrito abaixo permanece apenas na API. O Chrome
atual não permite usar o diretório normal de perfis como perfil Playwright;
escolher um perfil nativo não conecta a depuração a ele nem copia suas sessões.

Usa o Google Chrome instalado na máquina, com um perfil próprio guardado em
`~/.local/share/job-tracker/`, fora da pasta do projeto. Se a plataforma
pedir login, faça pelo próprio Chrome que abrir; a sessão fica salva nesse
perfil. O app preenche nome, email, telefone e links, deixa em branco o que não
reconhece e **nunca envia**: você revisa e clica em enviar.

Em **Vagas → Salvas → Preencher formulário**, o app procura o formulário e,
quando necessário, segue botões como “Candidate-se a esta vaga” e “Apply now”,
inclusive quando abrem outra aba. O caminho tem um limite de quatro etapas.
Ao encontrar o formulário, preenche os campos reconhecidos e deixa a janela
aberta para revisão. Formulários incorporados em frames também são considerados.

Se houver login, CAPTCHA ou uma etapa que o app não reconheça, ele avisa na
tela e deixa você continuar manualmente no Chrome. Botões dentro de formulários
não são acionados automaticamente, mesmo quando têm o texto “Apply”.

Em **Currículo → Preenchimento de candidaturas**, configure o nome completo,
a pretensão salarial e um resumo de experiência e clique em **Salvar**.
O botão **Usar resumo do currículo** copia seu texto para essa resposta.
As respostas são separadas por perfil e não entram no PDF do currículo.
Pretensão e resumo vazios não são preenchidos. A pretensão é copiada literalmente,
sem converter moeda ou período; use apenas números quando o formulário exigir.

Em **Currículo → Dados pessoais**, salve também LinkedIn, GitHub, portfólio/site
pessoal e o link do vídeo de apresentação. O preenchimento copia cada URL para
seu campo correspondente quando reconhecido. O vídeo é compartilhado como link,
sem baixar ou anexar um arquivo de vídeo. Confira se o recrutador consegue abrir
o endereço. Links vazios não são preenchidos.

Em **Currículo → PDF para candidaturas**, selecione um PDF de até 5 MB e clique
em **Guardar e ler PDF**. O texto é lido localmente, sem chave de API, para
preencher campos e seções vazios. Dados já preenchidos são preservados; revise
e clique em **Salvar**. Para reler um anexo existente, use **Ler PDF salvo**.
PDFs digitalizados como imagem precisam de OCR e não são lidos nesta versão.
Uma cópia local fica associada ao perfil, fora do projeto,
em `~/.local/share/job-tracker/resumes/` (ou em `XDG_DATA_HOME`, se definido).
Você pode substituir ou remover o arquivo na mesma seção. O preenchimento
seleciona o PDF em campos reconhecidos de currículo, inclusive campos ocultos
e botões como **Carregar currículo**, e informa o resultado. Confira o anexo
no portal antes de enviar; o portal pode aplicar validações adicionais.

Botões **Entrar com o Google** e equivalentes em inglês são priorizados quando
aparecem. A escolha de conta, senha e confirmações do Google ficam com você.
Se o fluxo parar nessa etapa, conclua o login na janela aberta e tente novamente.

## Como funciona por dentro

### Decisões que valem a leitura

**O LinkedIn entra sem acessar o LinkedIn.** O `robots.txt` dele é
`Disallow: /` e o contrato proíbe acesso automatizado; o custo de um
banimento seria a rede profissional inteira. Mas o LinkedIn manda as vagas
por email, e ler a própria caixa não é acessar o site. O app lê os alertas e
nunca abre a página da vaga. Como o alerta não diz se a vaga ainda aceita
candidatura, a descoberta esconde vagas de alerta mais velhas que um limite
que você escolhe nos filtros (14 dias por padrão).

**O modelo sugere, você decide.** "Seguimos com outros candidatos" e
"gostaríamos de seguir com você" são quase a mesma frase com sentidos
opostos. A leitura do email vira uma sugestão no card, com o motivo ao lado,
e o status só muda no seu clique. No "Resolver por IA" vale o mesmo: o modelo
escolhe a candidatura por número, numa lista que o servidor montou, e o
servidor confere se a empresa aparece de fato no email. Proposta sem esse
apoio vem desmarcada.

**O "De" de um email não prova nada.** Qualquer um escreve
`no-reply@gupy.com.br` no remetente. O app lê o resultado que o servidor de
email grava em cada mensagem (SPF, DKIM e DMARC) e só vincula sozinho, e só
manda ao Claude, o email cujo remetente foi confirmado para aquele domínio.

**Conteúdo de terceiros é dado, nunca instrução.** Descrição de vaga, corpo de
email e página web podem trazer texto tentando manipular o modelo. Esse
conteúdo vai delimitado, e a saída do Claude é sempre um campo estruturado
validado com Zod, nunca algo que o sistema execute.

**Resposta de formulário não inventa experiência.** O modelo só afirma o que
está no currículo ou nas suas anotações e cita o trecho de onde tirou cada
coisa. O servidor confere, sem IA, se o trecho existe, aponta números que não
aparecem em lugar nenhum e expressões com cara de texto de IA.

**Formulário nunca é enviado automaticamente.** Candidatura enviada não tem
desfazer. O contrato da API afirma isso: o campo `submitted` é `false`
literal, não booleano. Não existe forma de expressar um envio.

**O funil conta quem já chegou, não quem está.** Uma candidatura que passou
por entrevista, teste e oferta tem status atual `oferta`; contar o status
atual apagaria as etapas anteriores. O funil vem do histórico de transições,
conta candidaturas distintas e nunca cresce de uma etapa para a seguinte.

**A data da mudança não é a data do clique.** A entrevista é marcada na
segunda e você registra na quarta. Sem separar as duas, "tempo até a primeira
resposta" mediria o seu hábito de registro, não a velocidade da empresa.

**Número vazio é melhor que número inventado.** Com poucas candidaturas, as
taxas de conversão são omitidas em vez de mostrar "75%" sobre quatro casos.

### Stack

TypeScript em tudo, num monorepo com npm workspaces.

| Camada     | Tecnologia                                       |
| ---------- | ------------------------------------------------ |
| Telas      | Next.js 16 (App Router), React 19, Tailwind 4, Motion |
| API        | Nest.js 11                                       |
| Banco      | PostgreSQL 16 + Prisma 7                         |
| Contratos  | Zod 4, compartilhados em `packages/shared`       |
| Email      | `imapflow` + `mailparser`                        |
| Navegador  | `playwright-core` com o Chrome do sistema        |
| IA         | `@anthropic-ai/sdk`, com saída estruturada       |

```
recruiter-frontend/   Next.js: telas; fala com a API só pelo servidor do Next
recruiter-backend/    Nest: API, banco, email, navegador, Claude
packages/shared/      Schemas Zod usados pelos dois lados
docker-compose.yml    Postgres local
```

Só a API fala com o banco. Todo contrato que cruza os dois apps vive em
`packages/shared`, e a API revalida toda entrada mesmo quando a tela já
validou: validação no cliente é conforto, não controle.

## Segurança

**Tudo escuta só em `127.0.0.1`:** a API, as telas e o Postgres. A API não
tem autenticação, o que é deliberado para um app pessoal e só é seguro porque
ninguém mais a alcança. Com as portas abertas na rede, qualquer pessoa no
mesmo Wi-Fi leria seu currículo e seus emails. O Postgres usa a senha padrão
do `.env.example`, que é pública; ela só é aceitável porque a porta não sai da
máquina.

Escutar só localmente não basta contra o próprio navegador: um site aberto
nele consegue mandar requisições para `127.0.0.1` e, com DNS rebinding, ler as
respostas. Por isso a API e as telas recusam qualquer `Host` que não seja
`127.0.0.1` ou `localhost`, e a API só aceita escrita com
`Content-Type: application/json`, o tipo de requisição que um site de fora não
consegue mandar sem o navegador pedir licença antes.

**Não publique este app num servidor** sem antes adicionar autenticação. Não é
uma mudança de configuração.

Credenciais ficam só nos arquivos `.env`, que estão no `.gitignore`.

## Desenvolvimento

```bash
npm run build                      # compila os três pacotes
npm run lint                       # lint dos três pacotes
npm test -w recruiter-backend      # testes da API
npm run db:migrate                 # cria uma migration depois de mudar o schema
npm run db:studio                  # navega pelo banco
```

- Rode `npm run build:shared` de novo sempre que mexer em `packages/shared`:
  os dois apps importam o código compilado dele.
- O `dev:worker` reinicia a API a cada arquivo salvo e, com
  `IMAP_SYNC_ON_BOOT=true`, sincronizaria o email a cada reinício. Durante o
  desenvolvimento, use `IMAP_SYNC_ON_BOOT=false`.

## Problemas comuns

**A porta 5432 já está em uso.** Outro Postgres está rodando na máquina. Mude
`POSTGRES_PORT` no `.env` da raiz e a porta do `DATABASE_URL` em
`recruiter-backend/.env`.

**A tela abre, mas nada carrega.** A API não está rodando, ou o `API_URL` em
`recruiter-frontend/.env.local` não aponta para ela. Use
`http://127.0.0.1:3333`, e não `localhost`: a API escuta só em IPv4.

**"Este app só atende em 127.0.0.1 ou localhost".** Você abriu o app por
outro endereço, como o IP da máquina na rede. É a proteção descrita
em [Segurança](#segurança); abra por `http://127.0.0.1:3000`.

**O rótulo do Gmail não é encontrado.** Falta marcar *Mostrar no IMAP* nas
configurações de marcadores, ou o nome em `IMAP_MAILBOX` não é igual ao do
rótulo.

**A IA responde "sem crédito".** A chave existe, mas a conta da Anthropic está
sem saldo. Adicione créditos em `console.anthropic.com`.
