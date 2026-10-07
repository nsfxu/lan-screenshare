# Solução de problemas

Problemas comuns e como resolvê-los. Se o seu não estiver aqui, abra **Settings → About → Open logs** e veja o `screenshare.log`; as linhas perto do problema geralmente dizem o que deu errado.

> **Idioma:** [English](../en-US/troubleshooting.md) · Português (Brasil)

## Conteúdo

- [A sala não aparece](#a-sala-não-aparece)
- [Não consigo entrar](#não-consigo-entrar)
- [O vídeo não começa ou fica preto](#o-vídeo-não-começa-ou-fica-preto)
- [A qualidade está baixa](#a-qualidade-está-baixa)
- [Os espectadores veem o cursor do mouse num jogo](#os-espectadores-veem-o-cursor-do-mouse-num-jogo)
- [Problemas de áudio](#problemas-de-áudio)
- [CPU alta ou notebook esquentando](#cpu-alta-ou-notebook-esquentando)
- [Permissões do macOS](#permissões-do-macos)
- [Atualizações](#atualizações)
- [Reunindo informações para relatar um bug](#reunindo-informações-para-relatar-um-bug)

## A sala não aparece

```mermaid
flowchart TD
  A["A sala não aparece na lista"] --> B{"Mesma rede<br/>e sub-rede?"}
  B -->|"Não (VPN, outra sub-rede)"| C["Use Join by IP<br/>com o endereço do anfitrião"]
  B -->|Sim| D{"O firewall permite<br/>o ScreenShare?"}
  D -->|Não| E["Permita o ScreenShare em redes privadas<br/>(porta TCP 47800+, mDNS UDP 5353)"]
  D -->|Sim| F{"Wi-Fi de visitantes ou<br/>isolamento de clientes?"}
  F -->|Sim| G["Use uma rede normal,<br/>ou Join by IP"]
  F -->|Não| C
```

- A descoberta usa **multicast (mDNS)**, que muitas VPNs, redes Wi-Fi de visitantes e alguns roteadores bloqueiam. O **Join by IP** sempre funciona se o anfitrião estiver alcançável: ele vê os próprios endereços no **ⓘ** ao lado do nome da sala. Amigos em outras redes: veja [jogando pelo ZeroTier](zerotier.md).
- A porta padrão é **47800**. Se ela estava ocupada, o anfitrião escolheu a próxima livre; o **ⓘ** mostra a correta.
- **Firewall do Windows**: na primeira vez que você hospeda, o Windows pergunta se deve permitir o ScreenShare. Permita em redes **privadas**. Se você clicou em Cancelar, permita depois em *Segurança do Windows → Firewall → Permitir um aplicativo*.
- Uma sala que para de responder por 10 segundos sai da lista. Ela volta assim que responder de novo.

## Não consigo entrar

| Mensagem | O que significa | O que fazer |
|---|---|---|
| *This room runs ScreenShare 3.0.0, you have 2.0.0: update to join* | O anfitrião usa uma versão mais nova, com outro protocolo de sala, em que apps antigos não entram | Atualize o ScreenShare. |
| *…: the host needs to update* | O anfitrião usa uma versão mais antiga, com outro protocolo de sala | O anfitrião atualiza (ou alguém com a sua versão hospeda). |
| *This room runs a different app version* | O mesmo que acima, vindo de um anfitrião anterior ao 1.2.0 | Todos atualizam para a versão mais recente. |
| *Wrong PIN* (tentativas restantes) | O PIN não confere | Pergunte de novo ao anfitrião: o PIN pode mudar durante a sessão. |
| *Too many wrong PINs. Try again later.* | 3 PINs errados vindos do seu computador | Espere 5 minutos. |
| *Room is full* | Já há 10 pessoas dentro | Espere alguém sair. |
| *You were removed from this room* | O anfitrião removeu você | Só o anfitrião pode ajudar; uma nova sessão da sala limpa isso. |
| A lista de salas diz *Update to join* ou *Older version* | A sala usa uma versão incompatível (passe o mouse por cima para ver quem precisa atualizar) | Como acima. |
| A sala fica cinza / *Unreachable* | O app não consegue alcançar o anfitrião | Confira a rede e o firewall, ou se o anfitrião ainda está com o app aberto. |
| Erro de certificado no log (`rejected certificate`) | O certificado do anfitrião não bate com o que o seu app viu antes | Reinicie o ScreenShare do seu lado para ele reconhecer o anfitrião de novo. Se o anfitrião apagou o `host-identity.json`, isso é esperado. |

## O vídeo não começa ou fica preto

- **"Connecting…" por alguns segundos e depois toca**: normal quando a sua rede bloqueia o WebRTC (UDP). Depois de 8 segundos o app passa sozinho para a conexão TCP. **Try the faster connection again** no menu do botão direito da transmissão volta para o WebRTC.
- **Nunca conecta**: confira se os dois computadores permitem o ScreenShare no firewall. Como último recurso, ligue **Settings → Connection → Always use TCP transport** no espectador.
- **Quem transmite vê a própria transmissão normal, mas você vê preto**: a pessoa pode ter minimizado o app com **Pause sharing while minimized** ligado (o quadro mostra *Sharing paused*) ou compartilhado uma janela minimizada. Peça para ela usar **Change source**.
- **Você não vê a sua própria transmissão**: é de propósito. Clique em **Show my stream** no seu próprio quadro.
- **Capturas de tela do app saem pretas enquanto você assiste**: também é de propósito; gravar transmissões é bloqueado.

## A qualidade está baixa

1. Olhe os **selos de estatística** do quadro: resolução, fps e tipo de conexão.
2. Confira **Quality you receive** no menu do botão direito da transmissão: deve estar em **Auto** (ou na qualidade que você quer).
3. **O Auto acompanha o tamanho do quadro**: um quadro pequeno recebe uma transmissão pequena. Coloque a transmissão em destaque ou vá para tela cheia e a qualidade sobe em menos de um segundo.
4. Peça para quem transmite conferir a qualidade máxima (o menu do botão **Sharing**, ou **Stats**) e **Settings → Upload limit when sharing** (os 100 Mbps padrão são divididos entre todos que assistem; no Wi-Fi, 30–60 Mbps é mais realista).
5. O **Stats → Limited by** de quem transmite diz o motivo: *bandwidth* (rede), *cpu* (computador ocupado demais) ou *none*. Quando isso dura, quem transmite também recebe um aviso dizendo isso, com um botão para baixar a qualidade.
6. Na conexão **TCP** o atraso é um pouco maior e uma única codificação é dividida entre todos os espectadores TCP.

## Os espectadores veem o cursor do mouse num jogo

No Windows 10 (e no 11 anterior ao 24H2), compartilhar uma tela inteira mostra o cursor mesmo quando um jogo o esconde. O app resolve isso sozinho para jogos em **tela cheia**: enquanto o jogo esconde o cursor, ele compartilha a janela do jogo no lugar, e a sala avisa. Quando você dá alt-tab, ele volta para a sua tela.

- **O cursor ainda aparece por um segundo** quando você volta para o jogo: é o tempo da troca.
- **O jogo roda numa janela**: o app sugere compartilhar a janela dele (um aviso na sala). Você também pode escolhê-la em **Change source → Windows**.
- **A janela do jogo fica preta ao ser compartilhada**: jogos em tela cheia exclusiva nem sempre podem ser capturados como janela. Use tela cheia sem bordas ou em janela nas configurações do jogo.
- **Uma borda amarela em volta do jogo**: o Windows 10 a desenha enquanto uma janela é capturada. Os espectadores não a veem.
- **Você prefere continuar compartilhando a tela**: clique em **Share the screen instead** na sala. O app não troca de novo para aquele jogo até você compartilhar de novo.

## Problemas de áudio

| Problema | Solução |
|---|---|
| Nenhum áudio | Quem transmite precisa ligar **Share system audio** (pelo **Change source** durante a transmissão). O menu do **Sharing** mostra **No audio** quando nada está sendo capturado. |
| Sem som ao compartilhar uma janela (Windows) | **Only this app's sound** segue o app dono da janela. Alguns apps tocam o som por outro processo (alguns jogos abertos por um launcher, apps da Store), então nada é capturado. Desligue a opção em **Change source**: os espectadores passam a ouvir todo o som do sistema. |
| Sem áudio com headset 5.1/7.1 no Windows | O app passa automaticamente para o próprio auxiliar de áudio. Se ainda falhar, deixe o dispositivo em estéreo: *Configurações de som → dispositivo → Propriedades → Avançado → 2 canais*, e depois **Change source**. |
| Quem está na minha chamada do Discord ouve a própria voz | Compartilhe a **janela** do jogo com **Only this app's sound**, ou ligue **Leave out Discord** ao compartilhar (Windows, os dois ligados por padrão). Se aparecer um aviso dizendo que não foi possível, seu Windows é anterior ao 10 versão 2004: use **Mute audio** ou silencie a saída do Discord. |
| Outras transmissões fazem eco na minha | Seu computador toca as transmissões que você assiste, e compartilhar o áudio do sistema captura isso também. Com **Leave out Discord** ligado e o Discord fechado, o app deixa a si mesmo de fora e isso não acontece; senão (só um app pode ficar de fora), abaixe o volume das transmissões que você assiste ou silencie o seu áudio compartilhado. |
| Sem áudio no macOS | Precisa do macOS 13+ e da permissão de Gravação de Tela. Ainda não foi testado no macOS. |
| O espectador não ouve nada, mas quem transmite tem áudio | Confira o volume da transmissão no menu do botão direito, ou o alto-falante embaixo de uma transmissão em foco (cada transmissão tem seu próprio volume e mudo). |

## CPU alta ou notebook esquentando

- Abra **Settings → Advanced**: a tabela de codecs mostra **Hardware** ou **Software** para cada codec. Codificar em software gasta muito mais CPU. O **Automatic** já prefere H.264 em hardware.
- Diminua a **qualidade máxima** no menu do botão **Sharing** (por exemplo 720p @ 30 fps).
- Pare de assistir as transmissões de que não precisa (**Stop watching** no menu do botão direito); cada transmissão assistida custa decodificação.
- Deixe a sua própria transmissão escondida (não clique em **Show my stream**) enquanto compartilha.

## Permissões do macOS

- **Gravação de Tela**: *Ajustes do Sistema → Privacidade e Segurança → Gravação de Tela* → ative o ScreenShare e reinicie o app. O seletor de fonte mostra um botão que abre essa página quando falta a permissão.
- **Rede Local**: permita quando o sistema perguntar, senão as salas não são encontradas.

## Atualizações

- **"Couldn't check for updates"**: o computador não consegue chegar ao GitHub (sem internet, ou um firewall ou proxy bloqueia). Baixe a versão nova na [página de versões](https://github.com/nsfxu/lan-screenshare/releases); o instalador atualiza o app no lugar e mantém as suas configurações.
- **Não aparece "Restart to update" mesmo com versão nova publicada**: versões anteriores ao 2.2.0 não se atualizam sozinhas, e no macOS o app só mostra **Update to …**. Confira também se **Settings → About → Check for updates automatically** está ligado, ou clique em **Check now**.
- **A atualização baixa de novo a cada reinício**: o instalador baixado fica no cache de atualizações do app; algo (um limpador ou antivírus) pode estar apagando. O log (**Settings → About → Open logs**) tem linhas `updater:`.

## Reunindo informações para relatar um bug

Inclua, por favor:

1. A versão do app (**Settings → About**) e o sistema operacional de cada computador envolvido.
2. O que você fez, o que esperava e o que aconteceu.
3. O trecho relevante do `screenshare.log` de cada computador (**Settings → About → Open logs**). Tire antes qualquer informação privada.
4. Para problemas de qualidade: uma captura dos selos de estatística do quadro e do painel **Stats** de quem transmite.
