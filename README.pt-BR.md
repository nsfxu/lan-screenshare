# ScreenShare

**Compartilhe sua tela com as pessoas da sua rede: sem contas, sem nuvem, só a sua LAN ou VPN.**

> 🇺🇸 [Read in English](README.md)

O ScreenShare é um aplicativo de desktop para Windows e macOS. Uma pessoa abre uma **sala**; todo mundo na mesma rede vê a sala aparecer e entra com um clique (ou com um PIN, se a sala for privada). **Qualquer pessoa na sala pode compartilhar a tela**, várias ao mesmo tempo, e cada um escolhe quais transmissões quer assistir. As transmissões chegam a 1080p60 usando o codificador de hardware da placa de vídeo, com o som do computador se você quiser. Tem chat, uma lista de quem está assistindo quem e moderação simples para o anfitrião.

Tudo fica na sua rede. Não existe servidor para se cadastrar, e a única coisa que o app faz na internet é procurar atualizações nas versões publicadas deste projeto (dá para desligar).

```mermaid
flowchart LR
  H["Anfitrião<br/>abre a sala"] --- A["Alice<br/>compartilha a tela"]
  H --- B["Bob<br/>assiste a Alice"]
  A == "o vídeo vai direto<br/>da Alice para o Bob" ==> B
```

## Destaques

- 🔎 **As salas aparecem sozinhas**: as salas da sua rede surgem automaticamente, inclusive com amigos em outros lugares pelo [ZeroTier](docs/pt-BR/zerotier.md); em outras VPNs, digite o endereço do anfitrião.
- 🔒 **Salas públicas ou privadas**, com um PIN que o anfitrião pode trocar a qualquer momento.
- 🖥️ **Todo mundo pode compartilhar**, várias telas ao mesmo tempo, em grade ou em destaque. Nada toca até você escolher.
- 🎚️ **Qualidade do seu jeito**: quem transmite define o máximo, cada espectador escolhe o que recebe, e janelas pequenas gastam menos banda automaticamente.
- 🔊 **Som do computador**, inclusive com headsets 5.1/7.1, e uma opção para **deixar a chamada do Discord de fora** para seus amigos não ouvirem a própria voz (Windows).
- 💬 **Chat, fotos de perfil e controles do anfitrião**: remover pessoas, parar transmissões, silenciar o chat.
- 🌎 **Em português e inglês**, seguindo o idioma do seu computador (Configurações → Aparência → Idioma).
- ⬆️ **Se atualiza sozinho** no Windows: a versão nova baixa em segundo plano e é instalada quando você reinicia.
- 🔁 **Se recupera sozinho** depois de quedas curtas de rede e usa TCP quando a rede bloqueia o WebRTC.

## Como rodar

### O que você precisa

- [Node.js](https://nodejs.org/) **20.19+** ou **22.12+** (já vem com o npm) e [Git](https://git-scm.com/).
- Windows 10/11 ou macOS. O app também roda no Linux para desenvolvimento.

### Rodar a partir do código-fonte

```bash
git clone https://github.com/nsfxu/lan-screenshare.git
cd lan-screenshare
npm install
npm run dev
```

A janela do app abre. Clique em **Criar sala** para criar uma sala, ou espere as salas da sua rede aparecerem e clique numa para entrar.

### Testar com duas pessoas no mesmo computador

```bash
npm run build
npx electron . --profile=alice
npx electron . --profile=bob
```

Cada `--profile` tem suas próprias configurações, então as duas janelas se comportam como duas pessoas diferentes.

### Baixar

Os instaladores para Windows (`.exe`) e macOS (`.dmg`) estão na [página de releases](https://github.com/nsfxu/lan-screenshare/releases). Eles ainda não são assinados, então o SmartScreen do Windows pode avisar (**Mais informações → Executar assim mesmo**), e na primeira vez o macOS diz que não pode verificar o app: abra uma vez, feche a mensagem e clique em **Abrir Mesmo Assim** em *Ajustes do Sistema → Privacidade e Segurança*, com a sua senha ([passo a passo](docs/pt-BR/user-guide.md#abrir-pela-primeira-vez-no-macos)).

### Gerar um instalador

Para gerar o seu:

```bash
npm run dist:win   # instalador do Windows (.exe), rode no Windows
npm run dist:mac   # imagem de disco do macOS (.dmg), rode num Mac
```

O instalador é gravado em `release/<versão>/`. Apps podem estar na mesma sala desde que falem o mesmo protocolo de sala: todos os 1.x e 2.x falam.

### Conferir suas alterações

```bash
npm run typecheck
npm test
```

## Documentação

A documentação completa, em inglês e português, está em [`docs/`](docs/README.md):

- [Guia do usuário](docs/pt-BR/user-guide.md): todos os recursos e configurações.
- [Jogando pelo ZeroTier](docs/pt-BR/zerotier.md): amigos em outras redes, configurado em minutos.
- [Solução de problemas](docs/pt-BR/troubleshooting.md): quando algo não funciona.
- [Guia de desenvolvimento](docs/pt-BR/development.md): scripts, depuração e instaladores.
- [Arquitetura](docs/pt-BR/architecture.md), [protocolo](docs/pt-BR/protocol.md), [pipeline de mídia](docs/pt-BR/media-pipeline.md) e [segurança](docs/pt-BR/security.md): como funciona por dentro.
- [Como contribuir](docs/pt-BR/contributing.md) e [testes](docs/pt-BR/testing.md): como ajudar.
- [Changelog](CHANGELOG.md) (em inglês): o que mudou em cada versão.

Agentes de IA: comecem por [`AGENTS.md`](AGENTS.md).

## Licença

[MIT](LICENSE): você pode usar, modificar e compartilhar o ScreenShare livremente, desde que mantenha o aviso de copyright.
