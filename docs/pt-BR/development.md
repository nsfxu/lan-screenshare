# Guia de desenvolvimento

Como preparar o projeto, rodar, depurar e gerar instaladores.

> **Idioma:** [English](../en-US/development.md) · Português (Brasil)

## Conteúdo

- [Requisitos](#requisitos)
- [Primeira execução](#primeira-execução)
- [Scripts](#scripts)
- [Várias pessoas no mesmo computador](#várias-pessoas-no-mesmo-computador)
- [Como o build funciona](#como-o-build-funciona)
- [Depuração](#depuração)
- [Gerando instaladores](#gerando-instaladores)
  - [O certificado de assinatura do macOS](#o-certificado-de-assinatura-do-macos)
- [Traduções](#traduções)
- [Versões e o changelog](#versões-e-o-changelog)
- [Publicando uma versão](#publicando-uma-versão)
- [Tecnologias](#tecnologias)

## Requisitos

| Ferramenta | Versão | Observações |
|---|---|---|
| Node.js | 20.19+ ou 22.12+ | Exigido pelo Vite 7 / electron-vite 5. |
| npm | vem com o Node | O repositório usa `package-lock.json`. |
| Git | qualquer versão recente | |
| Windows | 10 ou 11 | Nada além disso. O auxiliar de áudio é compilado com o compilador C# que vem no Windows (.NET Framework 4). |
| macOS | 13+ recomendado | Necessário para gerar o `.dmg`. O áudio do sistema precisa do macOS 13+. |
| Linux | opcional | O app roda para desenvolvimento (a captura de tela funciona no X11), mas o Linux não é uma plataforma suportada. |

## Primeira execução

```bash
git clone https://github.com/nsfxu/lan-screenshare.git
cd lan-screenshare
npm install
npm run dev
```

O `npm run dev` inicia o electron-vite com recarregamento automático do renderer: mudanças na interface aparecem na hora. Depois de mudar algo em `src/main` ou `src/preload`, pare e rode `npm run dev` de novo, ou inicie com `npx electron-vite dev --watch` para recompilar e reiniciar automaticamente.

Antes de enviar uma mudança, rode:

```bash
npm run typecheck
npm test
```

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | Modo de desenvolvimento com recarregamento automático (compila antes o auxiliar de áudio do Windows). |
| `npm run build` | Build de produção do main, preload e renderer em `out/` (compila antes o auxiliar). |
| `npm start` | Roda o build de produção (`electron-vite preview`). |
| `npm test` | Roda todos os testes unitários e de integração uma vez (vitest). |
| `npm run test:watch` | Testes em modo observação. |
| `npm run test:e2e` | Compila e roda os testes de ponta a ponta: duas instâncias reais do app numa sala (veja [testes](testing.md#testes-de-ponta-a-ponta)). |
| `npm run typecheck` | Verificação do TypeScript do lado Node (`tsconfig.node.json`, inclui `tests/`) e do lado web (`tsconfig.web.json`). |
| `npm run build:native` | Compila os auxiliares nativos em `native/bin/`: no Windows `win-audio-capture.exe` e `win-cursor-watch.exe`, no macOS o `mac-audio-capture` e o `mac-window-list` universais (precisam do `swiftc` das ferramentas de linha de comando do Xcode); não faz nada no Linux ou se já estiverem atualizados. |
| `npm run dist:win` | Build + instalador do Windows (NSIS, x64 e arm64) em `release/<versão>/`. |
| `npm run dist:mac` | Build + imagens de disco do macOS (Intel e Apple Silicon) em `release/<versão>/`. Precisa rodar num Mac. |
| `npm run dist` | Build + instalador para a plataforma atual. |
| `npm run release -- <major\|minor\|patch>` | Prepara uma versão: número, seção do changelog e rascunho das notas (veja [publicando uma versão](#publicando-uma-versão)). Use `--dry-run` para só ver o resultado. |

## Várias pessoas no mesmo computador

Cada instância precisa das próprias configurações e identidade. Use `--profile=<nome>` com um build de produção:

```bash
npm run build
npx electron . --profile=alice
npx electron . --profile=bob
```

O `--profile=alice` guarda tudo numa pasta de dados separada (`ScreenShare-alice`). Uma instância cria a sala; a outra a encontra na lista (mDNS no mesmo computador), ou você pode usar **Join by IP** com `127.0.0.1:47800`.

Para deixá-las fora da tela que você está usando, adicione `--display=<n>` (a tela, numerada como no seletor de fontes: "Tela 3") e `--tile=<i>/<total>` (espaços lado a lado nela). Uma janela posicionada assim abre sem pegar o foco:

```bash
npx electron . --profile=alice --display=3 --tile=1/2
npx electron . --profile=bob --display=3 --tile=2/2
```

No Linux, é preciso `--no-sandbox` quando se roda como root, por exemplo dentro de um contêiner.

## Como o build funciona

```mermaid
flowchart LR
  subgraph Sources["Código-fonte"]
    M["src/main/*.ts"]
    P["src/preload/index.ts"]
    R["src/renderer (React + TS)"]
    S["src/shared, src/utils"]
    C["native/*/Program.cs"]
  end
  EV["electron-vite<br/>(Vite + esbuild/rollup)"]
  CSC["scripts/build-native.cjs<br/>csc.exe do .NET Framework 4"]
  OUT["out/main, out/preload, out/renderer"]
  EXE["native/bin/*.exe"]
  EB["electron-builder"]
  REL["release/versão/<br/>instalador .exe ou .dmg"]
  M --> EV
  P --> EV
  R --> EV
  S --> EV
  EV --> OUT
  C --> CSC --> EXE
  OUT --> EB
  EXE -->|"extraResources (Windows)"| EB
  EB --> REL
```

- O `electron.vite.config.ts` define três builds: main, preload e renderer (com o plugin do React).
- Cada auxiliar só é recompilado quando o seu `Program.cs` é mais novo que o seu `.exe`. Se outra instância do app estiver rodando um auxiliar, o `.exe` travado é renomeado para o lado (o Windows permite) e apagado num build seguinte. A pasta `native/bin/` é ignorada pelo git.
- O `electron-builder.json` empacota `out/**` num `asar`, adiciona os auxiliares como recursos extras no Windows e define os entitlements e as descrições de uso do macOS (Gravação de Tela, Rede Local, serviço Bonjour `_lanshare._tcp`).

### Trabalhando no auxiliar de áudio sem Windows

O auxiliar usa APIs do Windows, então só roda no Windows. Mesmo assim, dá para conferir se ele **compila** como C# 5 (o nível de linguagem do compilador que vem no Windows) usando o Mono:

```bash
mcs -langversion:5 -warn:4 -target:exe -out:/tmp/win-audio-capture.exe native/win-audio-capture/Program.cs
mcs -langversion:5 -warn:4 -target:exe -out:/tmp/win-cursor-watch.exe native/win-cursor-watch/Program.cs
```

Mantenha o C# 5: nada de interpolação de strings (`$"..."`), `?.`, `nameof`, membros com corpo de expressão ou `out var`.

## Depuração

- **DevTools**: aperte **Alt** para mostrar o menu e vá em *View → Toggle Developer Tools*, ou aperte **Ctrl+Shift+I** (**Cmd+Option+I** no macOS).
- **Logs**: o processo principal escreve em `screenshare.log` (veja [onde ficam seus arquivos](user-guide.md#onde-ficam-seus-arquivos)). Em desenvolvimento ele também imprime no terminal. O código do renderer registra logs por `window.api.system.log(...)`, que vão para o mesmo arquivo com o prefixo `[renderer]`. Prefixos úteis:
  - `[publisher]`: captura, áudio, conexões com espectadores, mudanças de qualidade;
  - `[watch <id>]`: uma transmissão assistida (transporte, fallback, qualidade escolhida);
  - `[win-audio]`: o auxiliar de áudio do Windows (qual processo fica de fora, erros).
- **Settings → Open logs** abre a pasta.
- **Estatísticas**: o **Stream stats** do menu Sharing (quem transmite) e os selos em cada quadro (espectador) mostram fps, bitrate, codec, codificador, RTT e o que limita a qualidade.
- A página **`chrome://webrtc-internals`** não é acessível pela janela do app, mas as estatísticas do WebRTC aparecem no DevTools por `RTCPeerConnection.getStats()`.

## Gerando instaladores

**Windows** (no Windows):

```bash
npm run dist:win
```

Gera `release/<versão>/ScreenShare-Setup-<versão>-<arch>.exe`: um instalador NSIS que deixa o usuário escolher a pasta e cria um atalho na área de trabalho.

**macOS** (num Mac):

```bash
npm run dist:mac
```

Gera duas imagens de disco: `ScreenShare-<versão>-arm64.dmg` para Apple Silicon e `ScreenShare-<versão>-x64.dmg` para Macs Intel. O `scripts/mac-sign.cjs` assina o app (`mac.sign` no `electron-builder.json`): com o certificado do projeto quando `MAC_SIGNING_IDENTITY` está definido (o workflow de release faz isso, veja abaixo), senão ad hoc (hardened runtime desligado). Um app sem nenhuma assinatura válida aparece como "danificado" no Apple Silicon depois de baixado, sem nenhum jeito de abrir; qualquer uma das duas assinaturas transforma isso no aviso de sempre, "não é possível verificar o desenvolvedor", que **Abrir Mesmo Assim** resolve. Para tirar o aviso é preciso um certificado Apple Developer ID para assinar e notarizar (e o hardened runtime ligado de novo); veja a documentação do electron-builder. O build de macOS ainda foi pouco testado.

### O certificado de assinatura do macOS

Uma assinatura ad hoc identifica o app pelo hash daquele build exato, então o macOS esquece a permissão de **Gravação de Tela** do ScreenShare a cada atualização: a chave nos Ajustes do Sistema continua parecendo ligada, mas o compartilhamento mostra só o papel de parede e as janelas do próprio app. Assinado com um certificado, o app passa a ser identificado pelo bundle id e pelo certificado (`codesign -d -r- ScreenShare.app` mostra `certificate leaf = H"…"`, não `cdhash H"…"`), e a permissão sobrevive a toda atualização assinada com o mesmo certificado.

O certificado é autoassinado (de graça; a Apple não o conhece, então ele não tira o **Abrir Mesmo Assim**). O electron-builder só procura certificados em que o macOS confia e o ignoraria, então o `scripts/mac-sign.cjs` o entrega ao `codesign` pelo SHA-1. Para configurar, uma vez:

1. Num Mac, rode `sh scripts/mac-signing-cert.sh <pasta fora do repositório>`. Ele cria o certificado e a chave privada (`screenshare-signing.p12`), uma senha para ele e o base64 para o secret.
2. Adicione os secrets do repositório `MAC_CERT_P12` (o base64) e `MAC_CERT_PASSWORD`; o script mostra os comandos `gh secret set`. O job de macOS do workflow de release os importa num keychain só dele, assina com eles e falha se o app não sair assinado com o certificado. Sem os secrets (forks), assina ad hoc como antes.
3. Guarde o `.p12` e a senha num lugar seguro e offline, por exemplo num gerenciador de senhas, e apague a pasta.

Use o mesmo certificado em todas as versões. Um novo (ou perder este) faz todo usuário de Mac permitir a Gravação de Tela mais uma vez; quem tiver o certificado consegue assinar um app que o macOS trata como o ScreenShare, permissão incluída. A primeira versão assinada com ele também precisa desse último "permitir de novo", para quem atualiza de uma versão ad hoc: diga isso nas notas dela.

## Traduções

Os textos do app ficam em [`src/shared/i18n/`](../../src/shared/i18n/): o `en.ts` é a referência (todas as chaves, em inglês) e cada outro idioma é um arquivo com as mesmas chaves (`pt-BR.ts`). O processo principal e a página usam os dois.

- **Num componente**: `const { t } = useT()` (`src/renderer/lib/i18n.tsx`), depois `t('room.leave')`. O componente se redesenha quando o idioma muda. Os campos são tipados: `t('room.pausedBy', { name })` não compila sem o `name`.
- **Fora de componentes** (código da página): o `t()` do mesmo módulo. **No processo principal**: `mainT()` (`src/main/i18n.ts`), para os erros e nomes que ele manda para a página.
- **Plurais**: uma chave pode ter formas por quantidade, `{ one: '{count} espectador', other: '{count} espectadores' }`, escolhidas pelas regras do próprio idioma (`Intl.PluralRules`). Passe o `count`.
- **Um nome em negrito no meio da frase**: `rich('room.pausedBy', { name: <strong>{name}</strong> })` mantém a frase inteira para quem traduz.
- **Números e horas**: `number(n, casas)` e `time(ts)` do `useT()` escrevem do jeito do idioma (português: `1,5 Mbps`).
- **Os avisos da sala no chat** ("Bob entrou") vão com um `event` (veja as [linhas do chat](protocol.md#linhas-do-chat)) e cada app os diz no próprio idioma; o `text` em inglês continua para os apps antigos.

**Adicionar um texto**: coloque a chave no `en.ts` e em todos os outros arquivos de idioma. O `npm run typecheck` aponta o idioma que ficou sem ela, e um teste de unidade confere que todos os idiomas usam os mesmos campos.

**Adicionar um idioma**:

1. Copie o `src/shared/i18n/pt-BR.ts` com a sigla do novo idioma (por exemplo `es.ts`), traduza, e mantenha as chaves e os `{campos}` como estão.
2. Coloque-o em `LANGUAGES` no `src/shared/i18n/index.ts`, com o nome no próprio idioma (`Español`) e a sigla do Chromium.
3. Coloque essa sigla em `electronLanguages` no `electron-builder.json` (nas duas entradas), para os instaladores levarem os arquivos do Chromium dela.
4. Cite o idioma na seção de idioma do guia do usuário, nas duas línguas.

Configurações → Aparência → Idioma já o lista sozinho, e "Igual ao computador" o escolhe nos computadores nesse idioma. Os testes de ponta a ponta rodam em inglês (`--lang=en-US` no `e2e/fixtures.ts`); o `e2e/language.spec.ts` confere a troca de idioma.

## Versões e o changelog

O ScreenShare segue o [Versionamento Semântico](https://semver.org/lang/pt-BR/), onde "incompatível" quer dizer *não consegue dividir uma sala*:

| Aumento | Quando | Exemplo |
|---|---|---|
| **Maior** (major) | O `PROTOCOL_VERSION` mudou (apps antigos não conseguem entrar nas salas novas, então todos precisam atualizar), ou um grande redesenho que mantém o protocolo (2.0.0: o novo layout). As notas dizem qual. | 1.4.2 → 2.0.0 |
| **Menor** (minor) | Novidades que ainda funcionam com outros apps da mesma versão maior | 1.0.0 → 1.1.0 |
| **Correção** (patch) | Só correções | 1.1.0 → 1.1.1 |

O [`CHANGELOG.md`](../../CHANGELOG.md) (em inglês, no formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)) lista toda mudança que o usuário percebe. **Cada pull request adiciona um arquivo em [`changes/`](../../changes/README.md)** em vez de editá-lo, para os pull requests não entrarem em conflito ali: uma ou mais entradas no grupo certo (`### Added`, `### Changed`, `### Fixed`, `### Removed`), escritas para quem usa o app: *"Viewers no longer see your cursor over fullscreen games that hide it"*, e não *"Add GameCursorGuard"*. Os testes unitários conferem cada arquivo ali. Mudanças internas (refatorações, testes, documentação) não precisam de um.

Não mude o `version` do `package.json` à mão; o `npm run release` faz isso.

## Publicando uma versão

As versões são geradas pelo GitHub Actions (`.github/workflows/release.yml`) nas máquinas Windows e macOS do próprio GitHub, então você não precisa ter os dois sistemas.

```mermaid
flowchart LR
  S["Actions → Release → Run workflow<br/>versão v1.2.0<br/>(ou enviar a tag)"] --> C["Typecheck + testes<br/>versão = package.json?"]
  C --> W["Instaladores do Windows<br/>windows-latest"]
  C --> M["macOS .dmg<br/>macos-latest (pode falhar)"]
  W --> R["GitHub Release v1.2.0<br/>notas = docs/releases/v1.2.0.md"]
  M --> R
```

1. Prepare com `npm run release -- minor` (ou `major`, `patch`, ou uma versão exata como `1.2.0`) num branch atualizado a partir da `main`, sem mudanças pendentes. Ele:
   - recusa se não houver nada para lançar (nenhum arquivo em `changes/` e nada em `[Unreleased]`), ou se o `PROTOCOL_VERSION` mudou desde a última versão e o aumento não for maior;
   - junta os arquivos de `changes/` (na ordem em que foram adicionados) numa seção datada `## [1.2.0]`, apaga-os e atualiza os links de comparação;
   - ajusta a versão no `package.json` e no `package-lock.json` (os nomes dos instaladores usam esse valor);
   - faz um rascunho de `docs/releases/v1.2.0.md`: tabela de downloads, se todos precisam atualizar, e as entradas do changelog. Troque os `TODO`s (uma introdução curta e o resumo em português) e deixe o texto bom para os usuários.

   Faça o commit (`Release v1.2.0`) e junte na `main` por um pull request.
2. Inicie a publicação de um destes jeitos:
   - No GitHub: **Actions → Release → Run workflow**, branch `main`, versão `v1.2.0`. O próprio workflow cria a tag.
   - Ou envie uma tag do seu computador: `git tag v1.2.0 && git push origin v1.2.0`. Se não houver arquivo de notas, a mensagem de uma tag anotada vira as notas.
3. O workflow confere se a versão bate com o `package.json`, se o `CHANGELOG.md` tem a seção dela e se as notas não têm mais `TODO`, roda as verificações, gera os instaladores e publica a versão com eles anexados, junto com o `latest.yml`: os apps do Windows já instalados leem esse arquivo para achar a versão nova (a entrada `publish` do `electron-builder.json` aponta para este repositório). Sem ele a publicação falha. O job do macOS pode falhar sem impedir uma versão só para Windows.
4. Quando o protocolo mudar, as notas avisam que todos na sala precisam da versão nova (o rascunho já faz isso).

Rodar o workflow sem versão é um teste: ele gera os instaladores, lista o que seria publicado e guarda os instaladores como artefatos da execução.

Cada sistema tem um instalador por tipo de processador: `-x64` (a maioria dos PCs com Windows, Macs Intel) e `-arm64` (Windows em ARM, Macs Apple Silicon).

Para os instaladores ficarem menores, eles só levam os arquivos de idioma do Chromium em inglês e português (`electronLanguages` no `electron-builder.json`). Num computador configurado em outro idioma, os poucos textos que o próprio Chromium desenha voltam para o inglês dos EUA (os textos do app seguem as [traduções](#traduções)). Um idioma novo também ganha a sua linha ali.

Os instaladores ainda não são assinados: o Windows mostra um aviso do SmartScreen (*Mais informações → Executar assim mesmo*) e o macOS bloqueia a primeira abertura até você clicar em **Abrir Mesmo Assim** em *Ajustes do Sistema → Privacidade e Segurança* (os instaladores de macOS são assinados com um certificado autoassinado, ou ad hoc sem ele; veja [o certificado de assinatura do macOS](#o-certificado-de-assinatura-do-macos)).

## Tecnologias

| Área | Escolha |
|---|---|
| Aplicativo de desktop | Electron 44 (Chromium + Node.js) |
| Build | electron-vite 5, Vite 7, TypeScript 5.9 (strict) |
| Interface | React 19, CSS puro (`src/renderer/styles.css`) |
| Mídia | WebRTC, WebCodecs, MediaStreamTrackProcessor/Generator |
| Rede | `ws` (servidor WebSocket), `http`/`https` do Node |
| Descoberta | `bonjour-service` (mDNS em JS puro) |
| Identidade TLS | `selfsigned` (certificados EC P-256) |
| Testes | vitest |
| Empacotamento | electron-builder (NSIS, DMG) |
| Auxiliar de áudio do Windows | C# 5, .NET Framework 4, WASAPI via interop COM |

Próximos passos: [arquitetura](architecture.md) · [como contribuir](contributing.md) · [testes](testing.md)
