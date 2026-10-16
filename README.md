# 🎮 Cofre de Contas de Jogos

Gerenciador de contas de jogos (login e senha) que roda **100% no navegador**: nenhum dado sai do seu computador.
As senhas são criptografadas com **AES-256-GCM** usando uma chave derivada da sua senha mestra
via **PBKDF2-SHA256 (600.000 iterações)**, tudo com a [Web Crypto API](https://developer.mozilla.org/pt-BR/docs/Web/API/Web_Crypto_API) nativa, sem bibliotecas de criptografia de terceiros.

![CI](https://github.com/Hendryck11st/cofre-senhas/actions/workflows/ci.yml/badge.svg)

**[▶ Ver demo](https://Hendryck11st.github.io/cofre-senhas/)**

<!-- Dica: adicione um print ou GIF aqui, ex.: ![Demonstração](docs/demo.gif) -->

## ✨ Funcionalidades

- Cofre protegido por senha mestra (com medidor de força), que pode ser trocada a qualquer momento
- Adicionar, editar, excluir e buscar contas de jogos (jogo, plataforma, nick, servidor, rank, login e senha)
- Filtro por plataforma (Steam, Riot, PlayStation…), com a cor de cada plataforma
- Tipo de conta (principal, smurf, compartilhada, banida) com filtro
- Contas do mesmo jogo agrupadas em blocos que abrem e fecham
- Ver a senha na lista (some sozinha depois de 20s)
- **Códigos 2FA (autenticador)** gerados no próprio app, inclusive Steam Guard (`steam://CHAVE`)
- **Aviso de senhas repetidas** entre contas, com filtro para encontrá-las
- Gerador de senhas aleatórias (criptograficamente seguro e sem viés)
- Copiar usuário/senha com **limpeza automática da área de transferência** após 30s
- **Bloqueio automático** após 5 minutos sem atividade
- Exportar/importar backup (o arquivo continua criptografado)
- Tema claro/escuro automático e layout responsivo
- **Instalável como app (PWA)** no PC e no celular, e funciona **offline** depois da primeira visita

## 🛡️ Como a segurança funciona

```
senha mestra ──PBKDF2 (600k iterações + salt aleatório)──▶ chave AES-256
                                                               │
dados das contas (JSON) ──AES-GCM (IV aleatório a cada gravação)──▶ localStorage
```

| Decisão | Motivo |
|---|---|
| PBKDF2 com 600.000 iterações | Torna ataques de força bruta caros (recomendação OWASP) |
| Salt aleatório de 16 bytes | Impede o uso de tabelas pré-calculadas (rainbow tables) |
| AES-GCM | Criptografa **e** autentica: dados adulterados são rejeitados |
| IV novo a cada gravação | Reutilizar IV com a mesma chave compromete o AES-GCM |
| Chave não-exportável | A `CryptoKey` não pode ser lida nem por scripts da página |
| Sem `innerHTML` | Dados do usuário nunca são interpretados como HTML (evita XSS) |
| Só links `http(s)` | Bloqueia URLs `javascript:` maliciosas |

A senha mestra **nunca é armazenada**. Se ela for esquecida, os dados não podem ser recuperados.

> ⚠️ **Projeto educacional.** O código não passou por auditoria de segurança. Para uso real,
> prefira gerenciadores consolidados como Bitwarden ou KeePassXC.

## 🚀 Como rodar

Pré-requisito: [Node.js](https://nodejs.org/) 20 ou superior.

```bash
git clone https://github.com/Hendryck11st/cofre-senhas.git
cd cofre-senhas
npm install
npm run dev
```

Acesse `http://localhost:5173`.

| Comando | Descrição |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm test` | Roda os testes |
| `npm run build` | Gera a versão de produção em `dist/` |
| `npm run preview` | Serve a versão de produção localmente |

## 📁 Estrutura

```
public/
├── manifest.webmanifest  # Dados do app instalável
├── sw.js                 # Service worker (modo offline)
└── icon*.png / icon.svg  # Ícones do app
src/
├── crypto.ts       # PBKDF2 + AES-GCM (Web Crypto API)
├── vault.ts        # Cofre: criar, desbloquear, CRUD, backup
├── generator.ts    # Gerador de senhas seguro
├── strength.ts     # Estimativa de força da senha
├── totp.ts         # Códigos 2FA (TOTP, RFC 6238) e Steam Guard
├── platforms.ts    # Cores e ícones das plataformas
├── icons.ts        # Ícones SVG da interface
├── main.ts         # Interface (DOM)
├── style.css
└── *.test.ts       # Testes com Vitest
```

A lógica (`crypto`, `vault`, `generator`, `strength`) não depende do DOM, por isso é testada
isoladamente. O `Vault` recebe o armazenamento por parâmetro, e os testes usam um armazenamento em memória.

## 🧪 Testes

```bash
npm test
```

Cobrem: criptografia de ida e volta, senha errada, detecção de adulteração, IV único,
gerador (tamanho, tipos de caractere, aleatoriedade), força da senha, CRUD, busca e backup.

## 🗺️ Próximos passos

- [ ] Categorias/pastas e favoritos
- [ ] Verificar senhas vazadas com a API [Have I Been Pwned](https://haveibeenpwned.com/API/v3#PwnedPasswords) (k-anonymity)
- [ ] Usar Argon2id (via WebAssembly) no lugar do PBKDF2
- [ ] Content Security Policy restritiva

## 📄 Licença

[MIT](LICENSE)
