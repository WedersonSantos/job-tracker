# Usar o Chrome já aberto

1. No perfil do Chrome que deseja usar, abra `chrome://extensions`.
2. Ative **Modo do desenvolvedor**, escolha **Carregar sem compactação** e selecione `D:\Job tracker\chrome-extension`.
3. Fixe **Job Tracker — preencher currículo** na barra de extensões.
4. No aplicativo, em Vagas salvas, clique **Preencher formulário**. Com o aplicativo no mesmo Chrome da extensão, uma aba já aberta para a vaga é ativada sem recarregar; uma nova aba é criada somente se não houver uma correspondente. Se a candidatura avançou para o formulário da empresa, essa aba é reutilizada. Não há escolha de perfil nem criação de perfil separado.
5. Na página da vaga, abra a extensão, confira o currículo e o site de destino e clique **Abrir formulário e preencher**. Se não houver um pedido ativo (por exemplo, após reiniciar o servidor), o painel oferece os currículos salvos e prepara um novo pedido para a própria aba ao clicar. Não é necessário voltar ao aplicativo apenas para recriar o pedido. Na primeira utilização, o Chrome pedirá permissão para os sites HTTPS; ela permite acompanhar portais e empresas de domínios diferentes.
6. A extensão segue até quatro etapas de candidatura, incluindo **Candidatar-se no site da empresa**, redirecionamentos e o botão da empresa. Links com `target="_blank"` são abertos na mesma aba do perfil escolhido. Botões JavaScript que abrem uma aba filha também são acompanhados. O processo continua mesmo que o painel da extensão feche.
7. Se houver login ou verificação de acesso, conclua manualmente. A extensão retoma ao voltar para o formulário ou mudar de etapa. Os campos reconhecidos e o PDF são preenchidos; etapas válidas avançam automaticamente e o envio final é manual. Pedidos expiram após dez minutos de inatividade ou quando o servidor reinicia.

A extensão consulta a API local `127.0.0.1:3333`. A navegação automática pede permissão opcional para sites HTTPS e executa apenas na aba iniciada e nas abas filhas abertas durante essa candidatura. A permissão fica concedida até você revogá-la na página de extensões. Não lê cookies ou senhas e não envia candidaturas. Campos já preenchidos e campos ambíguos são preservados. Formulários em iframes externos precisam ser abertos diretamente na aba ou preenchidos manualmente.

Se você já carregou uma versão anterior, abra `chrome://extensions` (ou `opera://extensions` no Opera) e clique **Recarregar** na extensão para usar a versão 1.12.1. Atualize também a página do aplicativo para ativar a comunicação com a extensão. O número da versão aparece no painel da extensão.

## Preparação do fit cultural / mapeamento comportamental

A versão 1.12.1 também identifica a questão **Ordene os itens de acordo com suas preferências**, com posições de 1 a 3. Quando os três controles são reconhecidos (select ou controles ARIA de lista), lê a frase e a posição dentro da mesma linha, sem usar a posição visual da linha como prioridade. Detecta posições repetidas, ordem completa e o número restante após duas escolhas distintas. O painel explica a regra e mantém o preenchimento e **Próximo passo** manuais. A extensão ainda não gera sugestões nem estima chance de aprovação; a definição de critérios pessoais para analisar frases novas está pendente.

Na versão 1.12.0, ao iniciar a automação no painel da candidatura da Gupy, a extensão reconhece **Iniciar teste** no cartão **Mapeamento Comportamental**, **Fit Cultural** ou **Perfil Comportamental**. Segue o redirecionamento, inclusive aba filha aberta pelo site, para `assessments.gupy.io/behavioral/...` e aciona o segundo **Iniciar teste** na tela **Vamos mapear o seu perfil?**.

Depois, segue **Próximo** nas dicas **Encontre seu lugar calmo**, **A internet está okay?** e **Reserve 15 minutinhos**. A execução termina ao encontrar **Começar a responder**; esse botão fica para você. As perguntas e respostas do teste são manuais, e nenhuma resposta é selecionada ou enviada. O painel confirma quando o botão está disponível. Se abrir a extensão já na parte das perguntas, ela também encerra a preparação sem preencher os controles.

A preparação tem limite próprio de dez passos, separado do limite de redirecionamentos da candidatura, e verifica a etapa novamente antes de cada clique. Não repete um botão se o site ficar na mesma tela. Outros tipos de teste, outros sites e telas sem identificação suficiente ficam para interação manual. A página precisa permanecer na aba acompanhada pela extensão; login ou verificação de acesso continuam manuais.

A correção 1.11.1 elimina o painel vazio quando não há pedidos temporários. Nesse caso, **Dados do currículo** passa a listar os perfis salvos no aplicativo. A escolha é feita antes de iniciar o preenchimento e cria somente um pedido local, sem abrir outro Chrome ou navegar para outra aba. Se já houver um pedido ativo criado pela aba de vagas, ele é preservado, inclusive a associação à vaga original. Se ainda não existir currículo salvo, o painel orienta a cadastrá-lo. Para personalizar a apresentação por IA, a descrição da vaga ainda precisa estar associada a uma vaga salva no aplicativo.

## PCD e autodeclaração

Em **Currículo → Preenchimento de candidaturas → PCD e autodeclaração**, configure **Pessoa com deficiência (PCD)**, **CID**, **Cor ou raça**, **Sexo**, **Identidade de gênero** e **Orientação sexual**. Todos começam sem resposta. **Não preencher automaticamente** deixa a pergunta para você; **Prefiro não informar** salva essa resposta para selecionar a opção correspondente quando o site a oferecer. Sexo, identidade de gênero e orientação sexual são independentes.

O CID aparece na configuração somente ao selecionar PCD **Sim**, deve ser copiado do seu documento e não é inferido ou validado como diagnóstico pelo aplicativo. Ao mudar PCD para outra resposta, o campo CID é limpo. O plano só inclui CID com PCD **Sim**; se o formulário já tem PCD **Não** ou uma recusa marcada, a extensão preserva a resposta e não preenche o CID. Clique **Salvar** no topo para guardar a configuração.

A extensão reconhece perguntas explícitas por rótulo, legenda de grupo ou ARIA, preenche campos de texto e seleciona opções correspondentes em radios, selects nativos e comboboxes reconhecidos. Não usa apenas nomes de campos ou códigos de opções para deduzir esses dados. Respostas já presentes são preservadas. Uma opção ausente ou ambígua fica para revisão, sem trocar uma identidade por outra ou inferir identidade de gênero a partir do sexo. Os dados ficam nas respostas de candidatura e não são acrescentados automaticamente ao currículo PDF, ao resumo ou ao pedido de apresentação por IA. O preenchimento desses dados exige a extensão 1.11.0; o antigo preenchimento em navegador separado os ignora. O envio final continua manual.

## Apresentação personalizada para a empresa

Em **Currículo → Preenchimento de candidaturas → Apresentação para empresas**, preencha **Apresentação-base** se quiser destacar pontos específicos da sua trajetória. Se deixar vazio, a IA usa o resumo e as demais informações profissionais do currículo. Ative **Personalizar e preencher a apresentação para cada empresa** e clique **Salvar** no topo. A opção começa desativada e funciona com a extensão 1.10.0.

Ao chegar à etapa **Apresente-se** da Gupy, inclusive no campo `personalization-step-text-area` sem label, a extensão pede um rascunho ao gerador de respostas por IA já configurado no aplicativo. Usa a empresa, o cargo, os requisitos e a descrição da vaga salva correspondente ao botão **Preencher formulário**. Usa palavras-chave sustentadas pelo currículo; não busca nem inventa dados sobre a empresa. A descrição da vaga precisa estar salva e a API de IA precisa estar configurada. Cada geração utiliza a API paga existente. O rascunho é reaproveitado por até dez minutos para o mesmo currículo, vaga e limite; alterações no currículo ou vaga geram uma nova versão.

O texto respeita o limite do campo, geralmente 1.500 caracteres. A extensão preserva texto já digitado, inclusive se você escrever enquanto aguarda a IA. Se o rascunho exceder o limite ou a checagem existente encontrar afirmações sem base ou números não confirmados, o campo fica para preenchimento manual e o painel mostra o motivo. Erros de configuração ou rede também aparecem no painel. **Parar automação** interrompe a espera e impede o preenchimento; uma geração já iniciada no servidor pode terminar. O envio final continua manual: revise a apresentação na própria página antes de enviar. Outros campos abertos, como “Por que deseja trabalhar nesta empresa?”, continuam manuais.

A versão 1.9.6 consulta as abas para encontrar o endereço da vaga e guarda, durante a sessão do navegador, a associação entre vaga e aba de candidatura. Isso preserva o formulário mesmo após redirecionamentos e reinício do processo de segundo plano. Cliques simultâneos são organizados em sequência para evitar duplicatas. Endereços diferentes continuam com abas próprias; uma aba fechada pode ser aberta novamente. A extensão não reutiliza abas de outro perfil do Chrome.

Quando o aplicativo está em outro navegador ou sem a comunicação local carregada, o Chrome recebe uma página temporária de encaminhamento no último perfil usado registrado pelo Chrome, como **Carlos** ou **Alexandre**. Se esse registro não estiver disponível, utiliza o primeiro perfil existente. A extensão encontra ou abre a candidatura e fecha somente essa página temporária. Para evitar também essa passagem, use o aplicativo no mesmo Chrome da extensão. Sem a extensão atualizada, a página de encaminhamento informa como recarregá-la.

A detecção da extensão aguarda até três segundos pela resposta do perfil onde o aplicativo está aberto. Se ela responder, esse perfil é usado diretamente, independentemente do perfil padrão ou do último perfil registrado no Chrome. O aplicativo não consulta abas de outro perfil. Cada perfil que for usar precisa ter a extensão carregada. A correção da escolha do perfil é do aplicativo/servidor e continua compatível com a extensão 1.9.6; basta atualizar a página do aplicativo.

A versão 1.9.1 reconhece **Adicionar arquivo** quando o próprio botão informa que é o arquivo do currículo. Se houver um campo de arquivo já montado no mesmo cartão, o PDF é associado diretamente a ele, inclusive no mundo isolado da extensão e sem abrir o seletor do sistema. Botões genéricos de certificado, foto ou outros documentos não recebem o currículo. O CPF de campos com `aria-labelledby` é preenchido somente quando estiver salvo no perfil; a extensão informa sua ausência na revisão final.

Em **Currículo → Preenchimento de candidaturas**, salve **Último salário** e **Expectativa salarial / pretensão** em campos separados. Ambos são opcionais e copiados como configurados, sem conversão de moeda ou período. O último salário é usado somente em perguntas explícitas de salário anterior/último salário; não é usado como salário atual nem como expectativa. Clique **Salvar** no topo para guardar os valores.

Na versão 1.9.2, perguntas da Gupy sem `label`, como **Qual a sua expectativa salarial?** e **Qual foi a sua última remuneração?**, são reconhecidas pelo nome completo do campo e pelo título `h3` imediatamente associado ao grupo de pergunta. Numeração e marca de obrigatoriedade são aceitas. Respostas já preenchidas, como um valor digitado manualmente, continuam preservadas. Sem último salário salvo, a extensão não inventa a última remuneração nem usa a expectativa em seu lugar.

A correção 1.9.4 aceita **Qual a sua última / atual remuneração?** como pergunta que permite o último salário cadastrado. A pergunta exata no nome do campo tem prioridade sobre títulos duplicados de outros grupos. Caso os campos salariais fiquem vazios após a atualização do formulário, a extensão espera e faz uma única nova tentativa com os valores já configurados, sem repetir o anexo do PDF e sem sobrescrever respostas existentes. Perguntas exclusivamente de salário atual continuam sem inferência.

A versão 1.5.0 também aciona **Entrar com Google**, preservando o login manual, e volta à aba de candidatura quando a aba de autenticação é fechada. O PDF pode ser anexado em campos já existentes ou por botões reconhecidos que criam/acionam um campo de arquivo. Anexos existentes são preservados; campos de carta de apresentação, foto e outros documentos não recebem o currículo.

Consulte [a verificação de funcionalidades e suas limitações](VERIFICACAO.md).

## Ashby

A versão 1.7.0 reconhece os campos da Ashby mesmo sem uma tag `<form>`, inclusive etapas com somente localização. Rótulos visuais dentro de `ashby-application-form-field-entry` complementam os rótulos HTML quando estes não estão vinculados ao input.

Em **Location**, a extensão consulta e seleciona uma sugestão que corresponda à cidade e ao estado cadastrados. Não escolhe resultados ambíguos ou de outro estado; nesses casos deixa o campo para revisão. **Your compensation expectations** recebe somente a pretensão salarial explicitamente configurada. O PDF vai para **Resume**, preservando o campo separado de importação **Autofill from resume**.

A correção 1.7.1 aguarda até seis segundos pela lista e compara siglas e nomes de estado nas duas pontas, inclusive sugestões como `Uberlândia, MG, Brasil` e `Uberlândia, Minas Gerais, Brazil`. Se a consulta não produzir uma opção inequívoca, o campo continua para revisão manual. A seleção foi testada também em um mundo isolado do Chrome, equivalente ao ambiente de execução da extensão.

Perguntas sobre problemas resolvidos e métricas de resultados precisam de resposta própria. **Submit Application** permanece manual.

## Gupy

A versão 1.9.5 também reconhece a tela **Olá…, vamos continuar sua candidatura!**, que mostra somente **Continuar** antes do formulário. A extensão avança dessa tela dentro da etapa `curriculum`, acompanha a troca de conteúdo no mesmo endereço e preenche os campos seguintes. Essa regra exige a mensagem de boas-vindas, o endereço de candidatura da Gupy, um único botão Continuar e ausência de campos visíveis e botões de envio final.

A versão 1.4.0 marca **Não** em “Você trabalha na empresa…?” e escolhe **LinkedIn** em “Onde você encontrou essa vaga?”, conforme configurado pelo usuário. Respostas existentes são preservadas. A lista de origem é aberta e sua opção é selecionada; a extensão não apenas digita o nome no campo. Essas respostas automáticas são restritas ao domínio `gupy.io`.

**Responder agora** também é reconhecido para abrir perguntas e etapas da candidatura. Perguntas sem resposta configurada continuam exigindo sua participação e o envio final é manual.

A versão 1.6.0 reconhece **Salvar e continuar** como envio intermediário da Gupy e acompanha a janela opcional **Apresente-se**, inclusive quando o endereço não muda. **Personalizar candidatura** abre a etapa de apresentação; um campo genérico “Apresente-se”/“Fale sobre você” recebe somente o resumo profissional configurado. Perguntas específicas sobre a empresa e indicação por funcionário ficam para o usuário. **Finalizar candidatura** nunca é acionado.

## Solutis / InHire

São reconhecidos o botão **Candidatar-se para a vaga** e o formulário que aparece após o carregamento da página. Nome, email, LinkedIn, pretensão salarial configurada, telefone e PDF usam os dados do currículo. O prefixo inicial `+55` no telefone não é tratado como número completo. CPF, país de origem e respostas pessoais sem configuração são apresentados para preenchimento manual; a cidade permanece bloqueada pelo site até selecionar o país. A etapa final **Continuar inscrição** é deixada para revisão manual.

Na versão 1.8.0, configure **CPF para candidaturas** e **País de origem** em **Currículo → Preenchimento de candidaturas** e clique **Salvar**. O CPF é validado pelos dígitos verificadores e não é inferido do nome ou de arquivos. O seletor da InHire é aberto e a opção cadastrada, como **Brasil (BR)**, é selecionada antes de preencher a cidade. O CPF também é reconhecido no campo `document.value` sem vínculo de rótulo HTML, somente quando a pergunta é CPF e o formulário não está no modo de documento estrangeiro. Valores já preenchidos são preservados. Esses dados ficam nas configurações de candidatura do perfil, sem alteração do currículo PDF.

A versão 1.8.1 acompanha a substituição do campo desabilitado `district` pelo seletor brasileiro `districtBr`. Aguarda a liberação, abre a lista, pesquisa a cidade do perfil e seleciona a opção com a UF correspondente, como **Uberlândia - MG**. Também funciona se Brasil já estava selecionado antes de iniciar. Se o campo continuar desabilitado ou não houver opção inequívoca, a extensão pausa para revisão; não remove o atributo `disabled`. A lista de países evita contar o botão e seu texto interno como opções distintas.

## Google Forms com várias páginas

A extensão reconhece cada etapa, mesmo quando nome e email ficaram nas páginas anteriores. Ela lê títulos vinculados por `aria-labelledby` e os títulos das perguntas do Google Forms. Campos já preenchidos são preservados.

- O nível de inglês vem do idioma cadastrado no currículo, sem estimar proficiência.
- Nas perguntas de tecnologias, marca somente opções que correspondem exatamente às competências salvas no currículo.
- Perguntas negativas, requisitos de experiência avançada e perguntas específicas sobre respostas anteriores ficam para sua revisão. A extensão informa perguntas de texto sem resposta configurada.
- As etapas válidas avançam automaticamente por **Continuar**, **Avançar** ou **Próxima**. Se faltar uma resposta obrigatória ou houver erro de validação, a extensão pausa. Complete a resposta e avance manualmente; ela retoma sozinha na próxima etapa, inclusive quando o endereço não muda.
- A extensão sempre para no envio final. Revise e clique **Enviar** manualmente. Botões de envio com texto de continuação, sem indicar que existem outras etapas, também exigem confirmação manual no site.
- Use **Parar automação** no painel para cancelar o acompanhamento desta candidatura.

O progresso guarda somente o identificador do pedido e metadados das etapas em `chrome.storage.session`, na memória da sessão do Chrome. Dados do currículo, respostas e PDF não são armazenados ali. Isso permite retomar após a suspensão/reinicialização do processo de segundo plano da extensão, sem acompanhar abas que você não iniciou. A permissão `storage` é necessária. Os pedidos têm validade de dez minutos de inatividade; o aplicativo renova esse prazo enquanto o preenchimento avança.

Ao atualizar o aplicativo durante uma candidatura, o pedido pode expirar ou desaparecer porque o servidor reiniciou. Nesse caso, gere um novo pedido pelo botão **Preencher formulário** do aplicativo e volte à aba em que já estava preenchendo.

O preenchimento pela interface usa somente os perfis habituais do Chrome e a extensão.
