# Banco de talentos: proposta para a versão hospedada

Status: desenho da próxima evolução, sem alteração de banco ou publicação de
dados. A instalação atual continua pessoal. Este documento não significa que
cadastro multiusuário ou pesquisa por recrutadores já estejam implementados.

## Decisões do produto

- Começar sem mensalidade, aceitando limites de recursos e disponibilidade.
- Usuários cadastram uma conta e preenchem/importam seu currículo.
- Futuramente, recrutadores pesquisam candidatos por habilidades e filtros.
- Acesso escolhido: **qualquer pessoa com uma conta de recrutador**, sem
  aprovação manual do administrador. O usuário continua decidindo se seu
  perfil aparece e quais meios de contato disponibiliza.
- Ser uma conta de recrutador não significa que a empresa foi verificada.
  Não apresentar selo de empresa verificada apenas por ter criado uma conta.

## O que já existe e o que falta

`Profile` já contém nome, email, telefone, localização, links e currículo.
As habilidades estão em `resume.skills`, como uma lista de textos.
O currículo PDF e sua extração também já possuem fluxo próprio.

Hoje, os perfis são variações de um mesmo dono: não há `ownerId`, login por
usuário, autorização por dono ou um diretório para recrutamento. A senha web
configurada para hospedagem protege a instalação inteira. Ela não separa
pessoas e não pode ser reutilizada como autenticação da plataforma pública.

Portanto, criar novos perfis no seletor atual não cria contas independentes.
Nenhum perfil existente deve passar a ser pesquisável automaticamente.

## Experiência proposta

1. A pessoa cria sua conta e confirma sua identidade pelo provedor de login.
2. Cadastra seu currículo ou importa um PDF. Confere nome, contato, localização
   e habilidades extraídas antes de salvar; dados faltantes ficam para revisão.
3. O currículo privado funciona mesmo sem participação no banco de talentos.
4. Na opção **Ser encontrado por recrutadores**, revisa uma prévia do perfil
   de divulgação, escolhe os contatos e confirma sua participação.
5. Contas de recrutador autenticadas pesquisam somente perfis publicados.
6. A pessoa edita, pausa a divulgação ou exclui seus dados conforme o fluxo de
   conta. Pausar remove imediatamente o perfil dos resultados e impede novas
   consultas de contato ou downloads autorizados por links antigos.

Exemplo de autorização de produto, a revisar antes do lançamento:

> Quero aparecer na busca de candidatos para pessoas com conta de recrutador.
> Posso pausar essa divulgação e escolher os contatos que serão exibidos.

Essa opção começa desmarcada. O texto precisa explicar o público real: uma
conta de recrutador pode ser criada sem aprovação manual. Não prometer que
somente empresas verificadas verão as informações.

## Dados do perfil para recrutadores

| Informação | Regra proposta |
| --- | --- |
| Nome de apresentação e título profissional | Escolhidos e revisados pelo candidato |
| Resumo profissional | Versão de divulgação, separada das respostas privadas de candidatura |
| Habilidades | Selecionadas pelo candidato; normalizadas para pesquisa |
| Cidade, estado e país | Campos separados; sem endereço residencial completo |
| Modalidade | Remoto, híbrido, presencial; preferências de localidade quando aplicável |
| Senioridade e disponibilidade | Declaradas pelo candidato, sem inferência silenciosa |
| Idiomas e certificações | Publicados somente se escolhidos |
| LinkedIn, GitHub e portfólio | Links escolhidos para divulgação |
| Email/telefone | Guardados na conta e liberados para recrutadores somente conforme a escolha específica do candidato |
| PDF do currículo | Privado por padrão; eventual compartilhamento exige escolha própria e controle de acesso |

CPF, nascimento, endereço completo, CID, saúde/PCD, raça/cor, orientação sexual,
sexo/identidade de gênero, última remuneração, emails de processos seletivos,
chaves de API e respostas de formulários não entram no índice geral de busca
ou nas respostas da API de recrutadores. Não devolver o `ProfileDetail` atual
para compor cartões do banco de talentos.

O PDF pode conter informações que não estão no cartão profissional. A primeira
versão pode usar apenas dados estruturados e manter o PDF privado até existir
uma versão de divulgação revisada. Nenhuma escolha de contato inicia envio
automático de email, WhatsApp ou candidatura.

## Busca inicial

- Habilidades com seleção de **todas** ou **qualquer uma**: por exemplo,
  `Python E SQL`, ou `Python OU Java`.
- Cidade/UF/país, modalidade, senioridade, idiomas e disponibilidade.
- Paginação e ordenação explícitas, com critério explicável de correspondência
  de habilidades. Não apresentar uma pontuação como chance de contratação.
- Sem filtro por atributos pessoais sensíveis no diretório geral.

Normalizar maiúsculas, espaços e aliases revisados (`JS` → `JavaScript`,
`Postgres` → `PostgreSQL`). Preservar o texto original e permitir correção.
Não fundir termos diferentes (`Java` e `JavaScript`, por exemplo). Uma menção
em uma descrição importada não confirma domínio da habilidade: o candidato
precisa revisar as sugestões. O banco inicial não depende de IA paga.

## Modelo de dados proposto

| Entidade | Responsabilidade |
| --- | --- |
| Account | Identidade autenticada e estado da conta |
| AccountRole | Papel de candidato/recrutador; possibilidade de ambos, sem conceder administração |
| Profile.ownerId | Dono do currículo privado e de seus dados vinculados |
| RecruiterProfile | Identificação de apresentação do recrutador e empresa informada |
| TalentProfile | Perfil profissional de divulgação vinculado à conta, originado de um currículo escolhido e revisado |
| Skill / TalentSkill | Catálogo, aliases, associação de habilidades e índices de pesquisa |
| VisibilitySettings | Divulgação ativa, contatos autorizados e eventual opção de compartilhar currículo |
| PublicationEvent | Registro de publicação, atualização e retirada, com versão do texto apresentado |

Uma pessoa pode ter vários currículos privados e apenas um cartão ativo no
diretório inicial. Não duplicar o candidato em cada resultado por possuir
variantes de currículo. O cartão guarda a versão que foi revisada: uma edição
do currículo privado não publica novas informações sem confirmação.

## Acesso e isolamento

1. A autenticação da conta precisa ser validada no backend. Não confiar no
   perfil selecionado, em `ownerId` recebido no corpo ou no papel enviado pelo
   navegador para decidir autorização.
2. Todas as consultas privadas devem derivar o dono da sessão. Isso inclui
   currículo/PDF, candidaturas, emails, busca salva, preferências, arquivos e
   tarefas de automação. Receber um ID não concede acesso ao registro.
3. A API de recrutadores usa uma projeção pequena de campos permitidos. Toda
   consulta revalida conta de recrutador e divulgação ativa, inclusive detalhes,
   contatos e arquivos; um índice ou cache desatualizado não pode reabrir dados.
4. URLs de anexos são privadas e temporárias, quando esse compartilhamento
   existir. Não usar bucket público para os currículos originais.
5. Prever limites de consulta/contato, bloqueio e denúncia de contas, além de
   registros mínimos para investigar abuso. Não oferecer exportação em massa
   do cadastro na primeira versão.
6. Na migração, somente o administrador atribui os perfis locais à sua própria
   conta. Um usuário recém-cadastrado não pode reivindicar um perfil antigo
   apenas por informar um email ou ID correspondente.

Usar autenticação gerenciada é uma possibilidade; ela não substitui os filtros
de autorização no Nest e no banco. Chaves administrativas de um serviço como
Supabase ficam somente no servidor. RLS, quando aplicável, deve ser testada
com credenciais dos usuários reais, além das verificações da aplicação.

## Hospedagem gratuita fora da Oracle

Consulta de limites em 13/11/2026; conferir novamente antes da publicação.

- **Render + Supabase:** Render para uma versão reduzida do app; Supabase para
  Postgres, autenticação e arquivos privados. Render gratuito suspende após
  15 minutos sem tráfego e perde arquivos locais em reinícios/suspensões.
  Portanto, a configuração de acesso, anexos e sessões de navegador não podem
  depender do disco efêmero do serviço. O Postgres gratuito do próprio Render
  expira em 30 dias e não é a proposta de armazenamento permanente.
- **Koyeb + Supabase:** alternativa semelhante. A instância web gratuita tem
  512 MB de RAM e 0,1 vCPU. Não assumir que o conjunto atual Next + Nest +
  Chromium cabe nesse limite: é preciso uma versão menor e teste de consumo.
  O banco gratuito do Koyeb tem limite próprio de atividade e não equivale a
  um Postgres permanentemente disponível sem restrições.
- **Supabase Free:** inclui 500 MB de banco e 1 GB para arquivos; projetos
  podem pausar após uma semana de baixa atividade. Não hospeda por si só o
  pacote Docker atual de interface + API + Chromium.

Recomendação de arquitetura para um piloto sem cobrança: separar o núcleo
**conta, currículo, banco de talentos e busca profissional** das pesquisas de
vagas com navegador e da extensão. Avaliar Render + Supabase como primeiro
piloto, com o serviço dentro das quotas gratuitas e sem promessa de operação
ininterrupta. Se o consumo não couber, medir e reduzir antes de liberar
cadastro; não habilitar upgrade/cobrança automaticamente.

Essa alternativa precisa de adaptação do pacote atual, criado para um servidor
com volumes persistentes. O cadastro público também precisa de um provedor de
login configurado, recuperação de conta e verificação de identidade/email.
Limites de envio de emails de autenticação devem ser conferidos; um plano
gratuito não significa serviço de email transacional ilimitado.

## Etapas de implementação e aceite

1. **Contas e isolamento:** login individual, papéis e vinculação de dono em
   todas as rotas privadas. Testar que A não lê, altera ou baixa dados de B,
   mesmo conhecendo seus IDs. Nenhum diretório público nesta etapa.
2. **Armazenamento hospedado:** banco e anexos externos persistentes, configuração
   de autenticação adequada ao serviço efêmero e teste de restauração/quotas.
3. **Preparar divulgação:** campos profissionais pesquisáveis, skills revisadas,
   prévia, escolha de contatos e participação desativada por padrão.
4. **Busca de recrutadores:** login de recrutador, filtros, paginação e acesso
   apenas a candidatos ativos; sem aprovação manual, conforme decisão acima.
5. **Piloto:** testar retirada da divulgação, exclusão, abuso, retomada após
   suspensão do serviço, uso de memória e custos/limites gratuitos reais.

Antes de abrir o cadastro, definir finalidade, aviso de privacidade, retenção,
canal de atendimento e procedimentos de exclusão e incidentes. A proposta
técnica não é uma declaração de conformidade jurídica; a operação e seus
termos precisam ser revisados para o lançamento.

## Fontes

- [Render: limitações dos serviços gratuitos](https://render.com/docs/free).
- [Koyeb: preços e recursos gratuitos](https://www.koyeb.com/docs/faqs/pricing).
- [Supabase: preços e limites](https://supabase.com/pricing).
- [Supabase: pausa de projetos gratuitos](https://supabase.com/docs/guides/platform/free-project-pausing).
- [ANPD: guia de segurança da informação para agentes de pequeno porte](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-sobre-seguranca-da-informacao-para-agentes-de-tratamento-de-pequeno-porte).
