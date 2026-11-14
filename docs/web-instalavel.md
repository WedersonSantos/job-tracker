# Job Tracker web instalável

O mesmo site pode ser adicionado ao computador, Android e iPhone/iPad como
aplicativo web (PWA). O instalador Windows continua disponível para executar
os serviços e gerar a extensão. Instalar o site não instala PostgreSQL nem a
extensão no celular.

## Instalar no dispositivo

1. Inicie o Job Tracker no computador. Abra `http://127.0.0.1:3000/instalar`.
2. No Chrome ou Edge, use **Instalar neste dispositivo**, quando oferecido,
   ou a opção de instalar aplicativo no menu do navegador.
3. No celular, abra o endereço **HTTPS** desta instalação. No Android, use a
   opção de instalar/adicionar à tela inicial. No Safari do iPhone/iPad, use
   **Compartilhar → Adicionar à Tela de Início → Adicionar**.

`127.0.0.1` no celular é o próprio celular, não o computador. Um endereço HTTP
da rede Wi-Fi não substitui o HTTPS necessário para a experiência instalável.
O navegador decide quando oferecer seu diálogo; dispensá-lo não impede usar
o site normalmente. Desinstalar o ícone não apaga os dados do servidor.

## Escolher onde o servidor roda

Para executar sem depender do computador pessoal, veja o
[pacote de hospedagem](../deploy/README.md), com build público, armazenamento
persistente, configuração inicial de senha e serviços de produção.

| Opção | O que muda |
| --- | --- |
| Computador pessoal | Precisa ficar ligado com API, interface e banco ativos. Uma conexão HTTPS precisa chegar até a interface. |
| Servidor próprio/hospedado | Funciona sem o computador pessoal ligado. Exige preparar banco, processos, armazenamento persistente, domínio/HTTPS e backups. Não há hospedagem contratada ou criada automaticamente. |

Esta versão é para **uma pessoa por instalação**, com uma senha para todos
os perfis. Não oferece cadastro público nem isolamento entre usuários.

## Configurar acesso por HTTPS

Antes de conectar um endereço externo, no próprio computador servidor:

1. Entre em **Instalar → Configurar endereço e senha**.
2. Informe a origem HTTPS exata, sem caminho, por exemplo
   `https://jobtracker.exemplo.com`, e uma senha de 12 a 128 caracteres.
3. Salve. A partir daí, o computador também pedirá senha quando a sessão
   terminar. Alterar a senha encerra as sessões anteriores.
4. Prepare um proxy HTTPS para encaminhar **somente a interface** em
   `127.0.0.1:3000`. Preserve o Host original e encaminhe
   `X-Forwarded-Proto: https`. Se usar X-Forwarded-Host, ele precisa ser o
   endereço HTTPS cadastrado. O proxy deve substituir cabeçalhos encaminhados
   enviados pelo cliente, em vez de confiar neles.
5. Abra o endereço no celular e entre com a senha. Sem sessão, nenhuma página
   privada é renderizada. API e PostgreSQL permanecem privados em loopback.

Exemplo de Caddyfile para quem já possui domínio apontando ao servidor:

```caddyfile
jobtracker.exemplo.com {
    reverse_proxy 127.0.0.1:3000
}
```

Esse exemplo exige DNS, certificado e conectividade preparados no servidor.
Não encaminhe as portas 3333 (API) ou do PostgreSQL para a internet. Trocar o
Host para localhost no proxy não remove a exigência de login, mas impede o
fluxo de login remoto correto. Use uma origem HTTPS exclusiva para o app.
Documentação: [proxy e HTTPS no Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy).

Para hospedagem, use uma instalação de produção com `npm run build:shared`,
geração do Prisma, migrations e builds dos dois apps. Execute o backend com
o comando de produção de seu pacote e a interface com
`npm run start -w recruiter-frontend`. Configure `API_URL` apenas no servidor,
apontando para a API privada. O painel Windows de desenvolvimento não é um
gerenciador de implantação em nuvem.

## Dados, senha e recuperação

- A senha é armazenada como hash scrypt com salt. Cookies de sessão são
  HttpOnly, SameSite Strict, vinculados à origem e duram até 12 horas; em
  HTTPS, recebem também Secure. Há limite de tentativas no processo de login.
- A configuração fica fora do código, em
  `$XDG_DATA_HOME/job-tracker/web-access.json` ou
  `~/.local/share/job-tracker/web-access.json`. O Windows instalado usa a pasta
  privada `data` da instalação. O arquivo contém um segredo de assinatura;
  não o compartilhe nem coloque no repositório.
- `JOBTRACKER_WEB_CONFIG` permite escolher um arquivo privado persistente
  para essa configuração. Os processos do Next devem compartilhar esse
  arquivo; esta entrega usa um processo/instância, sem distribuição horizontal.
- Para recuperar uma senha esquecida, primeiro interrompa o proxy/conexão
  externa. No servidor, remova somente o arquivo `web-access.json`, reinicie a
  interface e configure novamente pelo endereço local. Isso invalida as
  sessões; mantenha a conexão externa interrompida até salvar a nova senha.
- Não há contas pessoais, currículos ou chaves preenchidas no pacote público.

## Offline, atualizações e preenchimento

O cache contém apenas ícones e uma página estática de desconexão. Currículo,
emails, vagas, respostas e candidaturas não são guardados pelo service worker.
Se o servidor estiver desligado, o aplicativo instalado não consegue acessar
os dados. Nenhum formulário é colocado em uma fila de envio offline.

Quando há nova versão do service worker, o aviso **Atualizar app** permite
recarregar depois de salvar alterações. Outras mudanças do site chegam pelos
carregamentos normais do servidor, sem baixar um novo instalador no celular.

A extensão de preenchimento continua no Chrome do computador. A PWA não a
instala no Android/iOS nem automatiza sites de empresas no celular. Pelo
endereço remoto, a ação de preencher explica essa limitação, em vez de abrir
um Chrome na máquina do servidor. Busca que depende de navegador ou de
credenciais configuradas executa no servidor, que precisa desses recursos.

## Verificação de desenvolvimento

```powershell
npm run test:pwa
npm run build -w recruiter-frontend
node scripts/verify-pwa-browser.cjs
```

O último comando exige o Chrome do sistema (ou `CHROME_PATH`), utiliza API e
perfil fictícios, porta 3187 e configuração temporária. Confere manifest,
critérios de instalação do Chrome, layout, worker, login, bloqueio de páginas
e ações, origem e fallback offline. Não consulta banco pessoal. Capturas ficam
em `tmp/pwa-review`. Não substitui testar a instalação em dispositivos reais.

Referência de instalação: [MDN — aplicativos web instaláveis](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
