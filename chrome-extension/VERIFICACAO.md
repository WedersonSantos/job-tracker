# Verificação da integração com Chrome — versão 1.12.1

Comparação entre os módulos de preenchimento/navegação do backend e os arquivos executados pela extensão. Validação em Chrome headless com formulários controlados e testes do fluxo de segundo plano com API do Chrome simulada. Não equivale a testar todas as vagas reais de cada portal ou a validar o perfil pessoal do Chrome em uso.

Na versão 1.12.1, quatro casos de `assessment-preparation.spec.ts` verificam leitura da ordenação 1–3: vazia, duas posições diferentes, completa e repetida. Também trocam a ordem das linhas no DOM e confirmam que frase e valor continuam associados, sem clicar em Próximo passo. As suítes de preparação e progresso passaram com 28 testes. Isso cobre reconhecimento e validação, sem escolha automática de preferências ou previsão de aprovação.

Na versão 1.12.0, `assessment-preparation.spec.ts` reproduz as telas das capturas para identificar os botões de início e as três dicas, aguardar botão habilitado, rejeitar chave de etapa antiga, parar diante de Começar a responder e recusar testes técnicos vizinhos ou URLs não abrangidas. `extension-progress.spec.ts` percorre o painel da candidatura, o redirecionamento ao domínio de avaliações, o segundo botão de início e as três dicas no mesmo endereço; termina no quarto cartão, sem clicar em Começar a responder. Outro caso começa já na página de perguntas e confirma que nenhum campo, opção ou Próximo é acionado. Foram usados documentos controlados e APIs da extensão simuladas; nenhum teste real de candidatura foi iniciado.

A versão 1.11.1 corrige o caso documentado na captura: seletor de currículos vazio com a mensagem que exigia abrir a vaga pelo aplicativo. `extension-popup.spec.ts` executa o JavaScript real do popup em Chrome headless, com API local e APIs da extensão simuladas. Cobre ausência de pedidos com currículos salvos, preparo do currículo escolhido para a aba atual (`prepareOnly: true`), troca para outro currículo, preservação do pedido existente, ausência de currículos e recusa de permissão HTTPS. As três suítes de popup, pedido nativo e progresso passaram (29 testes). Não foram usados dados pessoais ou enviadas candidaturas nesses testes.

Na versão 1.11.0, `demographics.spec.ts` valida configurações antigas sem atribuir respostas, opções permitidas, CID somente para PCD Sim, correspondência das seis perguntas, seleção explícita de não informar, independência de sexo/gênero/orientação, preservação de respostas existentes e recusa de classificação por nomes de campos/códigos de opções/perguntas vizinhas. A extensão foi exercitada em mundo isolado do Chrome com radios, select, CID liberado após renderização e combobox com opções em portal; nenhum envio final foi acionado. Um teste adicional de `presentation.service.spec.ts` confirma que os novos dados de autodeclaração não entram no pedido feito ao gerador de apresentação. São 74 testes aprovados em seis suítes relacionadas, com TypeScript e ESLint nos módulos alterados. O teste da configuração intercepta o salvar para não alterar dados pessoais reais.

Na versão 1.10.0, `presentation.service.spec.ts` verifica a opção salva no currículo, associação à vaga original, uso da apresentação-base ou currículo, reaproveitamento da geração durante consultas de andamento, invalidação após alteração do currículo, falta de contexto/IA e recusa de textos longos ou com afirmações não confirmadas. A IA foi simulada, sem chamadas pagas nos testes. `presentation-extension.spec.ts` exercita o campo `personalization-step-text-area` do HTML enviado pelo usuário em um mundo isolado do Chrome, com preservação de texto, limite de 1.500 caracteres e envio final intacto. `extension-progress.spec.ts` verifica geração com consulta de andamento, preenchimento e parada antes do envio, edição manual durante a espera, cancelamento e falha da IA. A configuração foi verificada no aplicativo em desktop e celular, com o payload de salvar interceptado para preservar os dados pessoais existentes. O campo de PDF já existente apresenta overflow no celular, fora da nova seção de apresentação.

Na versão 1.9.6, `application-tabs.spec.ts` cobre reutilização da aba em outra janela sem navegar/recarregar, cliques simultâneos, vagas diferentes (preservando identificadores na query), formulário redirecionado em aba filha após reinício do worker, reabertura após fechar a aba, recusa de pedido inexistente, restrição da comunicação às páginas locais e fechamento exclusivo da página temporária de encaminhamento. `native-chrome.spec.ts` cobre preparação sem iniciar outro processo do Chrome e renovação do mesmo pedido para a mesma vaga e currículo. O registro das abas fica em `storage.session`, sem respostas pessoais ou PDF.

Verificação integrada local: clique real em **Preencher formulário** na página de vagas salvas, Server Action, backend e comunicação do content script foram exercitados em Chrome headless, com as operações de abas simuladas. Confirmados: primeira abertura, reutilização no segundo clique, preservação da etapa redirecionada e criação de outra aba após fechamento. Nenhuma candidatura foi enviada. TypeScript e ESLint passaram nos módulos alterados. O perfil pessoal e o recarregamento da extensão instalada não foram operados por esse teste.

Correção da escolha entre perfis: o caminho alternativo utiliza `profile.last_used` do arquivo Local State do Chrome, validado contra os identificadores cadastrados, em vez de dar preferência fixa a Default. Testes verificam Alexandre/Default e Carlos/Profile 2 com ambos cadastrados, metadados ausentes/inválidos e independência das abas de cada perfil. O teste da comunicação do frontend cobre resposta após um segundo (além dos antigos 500ms), timeout completo de três segundos e descarte de respostas malformadas. A comunicação direta com a extensão do perfil atual continua tendo prioridade sobre os metadados do Chrome. Não se trata de detectar a janela em primeiro plano no Windows: na ausência dessa comunicação direta, a referência é o último perfil usado registrado pelo Chrome.

| Função | Situação na extensão |
| --- | --- |
| Escolher perfil habitual do Chrome e currículo | Integrado com o aplicativo; teste do serviço de abertura de perfil |
| Nome, email, telefone e cidade cadastrados | Testados com o plano real do currículo |
| LinkedIn, GitHub, portfólio e vídeo | Testados com o plano real do currículo |
| Pretensão salarial e resumo configurados | Testados; respostas ausentes não são inventadas |
| Preservar valores existentes e perguntas sem resposta configurada | Testado |
| Candidatar-se no site da empresa e próximo botão de candidatura | Testado, incluindo redirecionamento entre sites |
| Entrar com Google | Corrigido nesta revisão; o botão é acionado, credenciais e escolha de conta continuam manuais |
| Voltar à candidatura quando a aba de login fecha | Corrigido; testada a restauração do estado após reiniciar o processo de segundo plano |
| PDF em campo de currículo existente | Testado, incluindo preservação do arquivo existente e recusa de campos ambíguos |
| Carregar currículo por botão com campo criado sob demanda | Corrigido; testado com criação atrasada de um campo sem nome e sem abrir o seletor do sistema |
| Não confundir currículo com carta de apresentação/foto/outros documentos | Corrigido e testado |
| Google Forms com várias páginas | Testado com títulos ARIA, tecnologias do currículo e nível de inglês cadastrado |
| Gupy: funcionário Não, origem LinkedIn, Responder agora | Testado com os modelos fornecidos pelo usuário |
| Gupy: Salvar e continuar, apresentação opcional e janela no mesmo endereço | Testados; preservado o envio final manual |
| Solutis/InHire: formulário público, telefone com prefixo +55 e dados pessoais pendentes | Página pública inspecionada; teste reproduz seus controles sem enviar dados ao site |
| InHire: país de origem e CPF configurados no currículo | Testados seleção real da opção, CPF sem label vinculado, atualização da cidade e preservação de respostas/documento estrangeiro |
| Ashby: campos sem tag form, localização sem vínculo HTML e pretensão em inglês | Página Lemon.io inspecionada; testes reproduzem sua estrutura e a seleção de cidade/estado |
| Continuar/Avançar e mudança de página sem reativação | Testado para navegação completa e mudança de etapa no mesmo endereço |
| Parar automação e não retomar após cancelamento | Testado |
| Campos obrigatórios/validação e envio final | Testada a pausa; não envia candidatura |

## Diferenças e limites restantes

- **Formulários em iframes:** o backend percorre frames; a extensão executa no documento principal. Abra o formulário diretamente na aba ou preencha o conteúdo incorporado manualmente.
- **Seletores de arquivo sem campo HTML de arquivo:** o backend consegue responder ao evento do seletor do Playwright; a extensão só anexa quando há um `input[type=file]`, inclusive criado pelo botão reconhecido. Interfaces que usam exclusivamente um seletor nativo ou API de arquivos precisam de anexo manual.
- **Controles personalizados:** campos padrão e o combobox de origem da Gupy estão cobertos; novos componentes de seleção e perguntas específicas podem exigir adaptação ou resposta manual.
- **Login, escolha de conta e CAPTCHA:** exigem participação do usuário. Bloqueio de popups ou políticas do portal também podem impedir o fluxo.
- **Busca de vagas e aplicação de filtros nos sites:** continuam no serviço de pesquisa do backend (`BrowserSearchService` e adaptadores de fontes). Essa automação não foi transferida para a extensão, cujo papel atual é preencher candidaturas.
- **Dados do pedido:** expiram após dez minutos sem renovação ou ao reiniciar o backend. Gere novo pedido no aplicativo nesse caso. O progresso da extensão dura a sessão do Chrome.

## Evidência

Na revisão 1.7.0, 85 testes passaram em 12 suítes: `ashby-extension`, `extension-auth`, `extension-parity`, `gupy-extension`, `inhire-extension`, `extension-progress`, `extension-navigation`, `extension-fill`, `google-forms-extension`, `native-chrome`, `field-plan` e `application-navigation`.

Na correção 1.7.1, 58 testes passaram nas oito suítes relacionadas ao preenchimento e às etapas: Ashby, Gupy, InHire, Google Forms, localização, navegação e progresso da extensão. Os novos cenários verificam sugestões com atraso de três segundos, siglas de estado e execução no mundo isolado do Chrome. O campo foi selecionado também na página pública da Lemon.io com a localização do perfil, sem enviar uma candidatura.

Na versão 1.8.0, 64 testes passaram em oito suítes, incluindo validação de CPF, compatibilidade com configurações antigas, seleção de Brasil no componente realista da InHire, atualização da cidade após selecionar o país e preservação de documentos estrangeiros. Os novos campos foram confirmados na página de currículo do perfil, e Brasil foi salvo conforme informado pelo usuário; nenhum CPF foi inferido ou cadastrado por esta implementação.

Na correção 1.8.1, 65 testes passaram em oito suítes. A reprodução cobre a substituição atrasada de `district` por `districtBr`, o caso de país já selecionado, a pesquisa pelo nome da cidade e a escolha da UF correta. Na página pública da Solutis, a execução em um mundo isolado do Chrome selecionou **Brasil (BR)** e **Uberlândia - MG**; nenhuma candidatura foi enviada.

TypeScript do backend, ESLint dos arquivos alterados e sintaxe dos módulos JavaScript também foram verificados.

Na versão 1.9.0, 46 testes passaram em quatro suítes relacionadas a plano de campos, extensão e serviço nativo. Os cenários de salário distinguem último salário de pretensão salarial e deixam salário atual sem preenchimento. Os dois campos foram confirmados na página de currículo do perfil; nenhum valor salarial foi alterado por esta implementação.

Na correção 1.9.1, 56 testes passaram em oito suítes. O HTML fornecido para **Adicionar arquivo** e CPF foi reproduzido com upload de currículo e certificado separados. A execução em mundo isolado preencheu o CPF configurado e associou o PDF ao campo do cartão de currículo sem abrir o seletor do sistema, preservando anexos anteriores. Sem CPF configurado, o campo ficou vazio para revisão. Não houve envio de candidatura.

Na correção 1.9.2, 59 testes passaram em sete suítes. Foram reproduzidas perguntas numeradas da Gupy com textarea sem label e identificação pelo nome da pergunta ou por `h3`, incluindo última remuneração, expectativa e preservação de resposta manual. O localizador do backend também aceita o nome da pergunta. Nenhum dado salarial do perfil foi alterado.

Na correção 1.9.4, 62 testes passaram em seis suítes. A pergunta combinada **Qual a sua última / atual remuneração?** recebe o último salário configurado; a expectativa usa seu próprio valor. A execução em mundo isolado foi testada com um título duplicado, sem preencher perguntas não relacionadas. O fluxo de segundo plano foi testado com uma atualização simulada que apaga as duas respostas: houve uma única nova tentativa, sem envio de candidatura.

Na correção 1.9.5, 25 testes passaram em cinco suítes. A reprodução da tela de boas-vindas da Gupy clicou **Continuar** uma única vez, preencheu o formulário seguinte no mesmo endereço e parou no envio final. Três casos negativos confirmaram que telas de outros sites, outros caminhos e telas sem a mensagem de boas-vindas não recebem essa navegação automática.

Para usar as correções, recarregue a extensão em `chrome://extensions`, confirme a versão **1.9.5** no painel e inicie um novo pedido de preenchimento pelo aplicativo. A atualização dos arquivos locais não recarrega automaticamente a extensão instalada no Chrome.
