# Job Tracker

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Pessoa que acompanha suas candidaturas e preenche formulários com o currículo salvo localmente.

## Product Purpose

Buscar vagas, organizar candidaturas e reduzir a digitação nos sites de recrutamento.

## Operating Context

Aplicação local em Windows, com API NestJS, interface Next.js, PostgreSQL e extensão Chrome Manifest V3. O atalho inicia o painel de serviços e abre o aplicativo no navegador padrão após a inicialização concluir. O título da aba é JOB TRACKER; a janela integrada fica como opção. Chrome permite candidaturas com a extensão. Novas instalações incluem PostgreSQL privado; versões antigas preservam a configuração Docker.

## Capabilities and Constraints

O painel abre a aplicação e gera a extensão para instalar pelo modo de desenvolvedor. O instalador permite escolher a pasta e inclui guia, PostgreSQL privado e desinstalador, sem perfis ou credenciais pré-carregados. Node.js e Visual C++ x64 podem ser preparados com autorização. O desinstalador preserva dados por padrão. A configuração de API usa chave própria. A instalação automática da extensão e a publicação na Chrome Web Store não fazem parte desta entrega.

## Product Principles

- Dados e serviços locais, com acesso pela interface de loopback.
- Reutilizar serviços já ativos.
- Indicar erros e o próximo passo em português.
- Manter a revisão e o envio final das candidaturas com o usuário.
