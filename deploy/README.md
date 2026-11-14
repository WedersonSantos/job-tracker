# Hospedagem de uma instalação pessoal

Este pacote prepara o Job Tracker para um servidor Linux com Docker Compose
e HTTPS por proxy. O usuário do celular não instala Docker nem PostgreSQL.
O servidor fica ligado independentemente do computador pessoal.

Não é um serviço multiusuário: a senha de acesso libera todos os perfis desta
instalação. A hospedagem, o domínio, backups e a conta do provedor precisam
ser definidos antes da publicação. Não existe servidor contratado ou publicado
por estes arquivos.

## Arquitetura

- API e Next no mesmo container, para a API continuar em `127.0.0.1:3333`.
- Apenas o Next é publicado em `127.0.0.1:3000` **no host do servidor**.
- PostgreSQL em container separado, sem portas publicadas.
- Volumes distintos para banco e arquivos: currículo, anexos, fontes e hash da
  senha sobrevivem a recriações dos containers.
- Proxy HTTPS no host encaminha o domínio para `127.0.0.1:3000` e preserva o
  Host. Somente 80/443 são públicos. O Next escuta em `0.0.0.0` somente dentro
  de seu container; não altere a publicação de porta para `0.0.0.0` no host.
- A busca por cliques usa Chromium sem janela. Sites com captcha/login manual
  podem ficar indisponíveis nessa modalidade e mostram o motivo.

## 1. Preparar código público

No checkout atualizado, com Node/npm disponíveis:

```sh
npm run prepare:hosted
```

O comando gera `dist/hosted/context` usando a mesma lista pública revisada do
instalador. Não copia `.env`, banco, perfis, currículos, caches ou chaves da
máquina de desenvolvimento. O Dockerfile recebe **somente essa pasta**.

Se o contexto já existir, o comando recusa reutilizá-lo. Preserve ou remova
essa saída de build antes de gerar outra; uma pasta com arquivos desconhecidos
nunca é reaproveitada. O contexto tem um inventário SHA-256 público.

Envie ao servidor o contexto, `deploy/compose.yml`, `deploy/.env.example` e
`deploy/Caddyfile.example`, mantendo a mesma posição relativa entre `deploy`
e `dist`. Também é possível clonar o código no servidor e gerar o contexto lá.

## 2. Configurar o servidor

Instale Docker Engine/Compose e um proxy HTTPS, como Caddy, no servidor Linux.
O build usa Node 22, Chromium, npm e downloads de fontes: precisa de acesso à
internet. O destino precisa ter armazenamento persistente; hospedagem estática
ou uma função serverless isolada não executam este pacote completo.

Na raiz do projeto, no servidor:

```sh
umask 077
cp deploy/.env.example deploy/.env.hosted
```

Edite esse arquivo privado:

- `WEB_ORIGIN`: origem HTTPS exata, sem barra final/caminho, do domínio escolhido.
- `POSTGRES_PASSWORD`: 64 caracteres hexadecimais aleatórios. Gere com
  `openssl rand -hex 32` no servidor e salve no arquivo. Não use o exemplo de
  desenvolvimento nem publique essa senha.
- Opcionalmente, chave da API e IMAP próprios. Use senha de aplicativo no IMAP.
  Não há cópia automática da chave protegida pelo Windows para a nuvem.

Não envie esse arquivo ao GitHub. A troca da senha do banco no `.env.hosted`
não altera automaticamente a senha de um volume PostgreSQL já inicializado.

## 3. Build e primeira senha

```sh
docker compose --env-file deploy/.env.hosted -f deploy/compose.yml build app
docker compose --env-file deploy/.env.hosted -f deploy/compose.yml run --rm --no-deps app node --import tsx deploy/configure-access.ts
```

O segundo comando pergunta a senha web sem exibir os caracteres. Ela fica como
hash, junto com uma chave de sessão, no volume privado de arquivos. Esse passo
não inicia API, banco ou interface. Se a senha estiver ausente ou a origem for
inconsistente, a inicialização hospedada falha antes de abrir os serviços.

## 4. Iniciar e conectar HTTPS

```sh
docker compose --env-file deploy/.env.hosted -f deploy/compose.yml up -d
docker compose --env-file deploy/.env.hosted -f deploy/compose.yml ps
docker compose --env-file deploy/.env.hosted -f deploy/compose.yml logs --tail=50 app
```

O banco precisa ficar saudável antes de iniciar o app. O app aplica migrations,
inicia a API, espera sua resposta e só então inicia a interface de produção.
O healthcheck acompanha API e interface. Se qualquer processo principal parar,
o container encerra os outros e a política de reinício assume a recuperação.

Configure o Caddy no host com `Caddyfile.example`, substituindo o domínio pelo
mesmo cadastrado. Prepare DNS e certificado HTTPS. O proxy preserva o Host e
encaminha o protocolo HTTPS. Não publique a porta 3333 ou a do PostgreSQL.
Depois, abra o domínio no celular, entre com a senha e use a aba **Instalar**.

Se o domínio exigir configuração externa, isso é concluído na conta escolhida;
não há domínio padrão fictício funcionando. As capturas e os testes locais não
substituem conferir certificado, login e instalação no endereço real.

## Atualizar e preservar dados

Faça backup antes de atualizar. Gere um **novo** contexto público com o código
atualizado, faça build e execute `up -d`. O banco e os arquivos ficam nos volumes.
Nunca use `docker compose down -v` para uma atualização: esse comando apaga
os volumes. Arquivos da instalação Windows não são migrados automaticamente.

Backups precisam incluir **os dois volumes**: um dump PostgreSQL consistente
e o diretório `/data` do app. Trate como privados e mantenha uma cópia fora do
servidor. Planeje e teste a restauração no provedor antes de depender do serviço.
Este pacote não configura backups agendados nem proteção oferecida pelo provedor.

Para redefinir a senha web, execute novamente o comando interativo de
`configure-access.ts` e reinicie o app; a nova chave invalida sessões anteriores.
Se alterar também o domínio, atualize `.env.hosted`, o acesso web, DNS e proxy.

## Limitações nesta etapa

- Preenchimento de candidaturas pela extensão permanece no Chrome do computador.
  A versão web no celular permite consultar/editar dados e abrir as vagas.
- Sites de vagas podem bloquear IPs de datacenter ou exigir interação manual.
  Chromium headless não resolve captcha e não recebe sua sessão pessoal do Chrome.
- Ainda é necessário escolher a conta de hospedagem e concluir a publicação.
- Se Docker não estiver disponível no ambiente de desenvolvimento, a imagem
  precisa ser construída e validada no servidor escolhido antes de uso real.

Referências: [ordem de inicialização no Compose](https://docs.docker.com/compose/how-tos/startup-order/)
e [proxy HTTPS com Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy).
