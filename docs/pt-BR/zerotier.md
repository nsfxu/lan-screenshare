# Jogando pelo ZeroTier

Como usar o ScreenShare com amigos que não estão na sua rede, usando o [ZeroTier](https://www.zerotier.com/). O ZeroTier coloca os computadores de todos numa rede virtual privada, então o ScreenShare funciona como se todos estivessem na mesma casa: **as salas aparecem na lista sozinhas**, e o vídeo vai direto de quem compartilha para quem assiste.

É gratuito para um grupo pequeno. A configuração leva uns cinco minutos na primeira vez, e mais ou menos um minuto para cada amigo.

> **Idioma:** [English](../en-US/zerotier.md) · Português (Brasil)

## Conteúdo

- [O que você precisa](#o-que-você-precisa)
- [1. Crie a rede (uma pessoa, uma vez)](#1-crie-a-rede-uma-pessoa-uma-vez)
- [2. Todos entram](#2-todos-entram)
- [3. Aprove seus amigos](#3-aprove-seus-amigos)
- [4. Use o ScreenShare](#4-use-o-screenshare)
- [Se algo não funcionar](#se-algo-não-funcionar)
- [Privacidade](#privacidade)

```mermaid
flowchart LR
  A["Você cria uma rede<br/>em my.zerotier.com"] --> B["Os amigos instalam o ZeroTier<br/>e colam o ID da rede"]
  B --> C["Você aprova cada um<br/>(Members → Auth)"]
  C --> D["Abra o ScreenShare:<br/>a sala está na lista"]
```

## O que você precisa

- O **ScreenShare** em todos os computadores (veja o [guia do usuário](user-guide.md)).
- O **ZeroTier One**, o app do ZeroTier, em todos os computadores: baixe em [zerotier.com/download](https://www.zerotier.com/download/). Ele funciona no Windows e no macOS.
- **Uma conta no ZeroTier**, para quem cria a rede. Os amigos que só entram não precisam de conta.

## 1. Crie a rede (uma pessoa, uma vez)

1. Entre em [my.zerotier.com](https://my.zerotier.com/) e clique em **Create A Network**.
2. A rede nova aparece com o **Network ID** dela: 16 letras e números, como `8056c2e21c000001`. O ZeroTier cria esse ID; você não escolhe. É isso que os seus amigos vão colar.
3. Abra a rede e confira as configurações:
   - **Name**: qualquer nome, por exemplo "ScreenShare".
   - **Access Control**: deixe em **Private**. Assim, quem tem o ID pode *pedir* para entrar, mas só entra quem você aprovar.
   - **IPv4 Auto-Assign**: deixe ligado. Ele dá a cada um um endereço na rede (por exemplo `10.147.17.x`).
4. Instale o ZeroTier One no seu computador e entre na sua rede como no próximo passo.

## 2. Todos entram

Em cada computador, inclusive no do anfitrião:

1. Instale o **ZeroTier One** e abra.
2. Abra o menu dele:
   - **Windows**: clique no ícone do ZeroTier perto do relógio (ele pode estar escondido atrás da setinha **^**) → **Join New Network…**
   - **macOS**: clique no ícone do ZeroTier na barra de menus → **Join New Network…**
3. Cole o ID da rede e clique em **Join**.
4. **O Windows pergunta se este computador deve ficar visível para outros dispositivos da rede: responda Sim.** Assim o Windows trata a rede do ZeroTier como privada. Se você responder Não, o firewall do Windows pode bloquear o ScreenShare.
5. O macOS pode pedir para permitir o ZeroTier em *Ajustes do Sistema → Privacidade e Segurança*; permita.

A rede aparece como *Requesting configuration* ou *Access denied* até ser aprovada.

## 3. Aprove seus amigos

Em [my.zerotier.com](https://my.zerotier.com/), abra a sua rede e desça até **Members**. Cada computador que pediu para entrar aparece ali: marque **Auth** ao lado dele. Dê um nome curto a cada um (quem é), para reconhecê-los depois.

Alguns segundos depois, a rede aparece como **OK** no ZeroTier do computador deles, com um endereço.

## 4. Use o ScreenShare

Não precisa mudar nada no ScreenShare: ele enxerga a rede do ZeroTier como a rede da sua casa.

- **Anfitrião**: clique em **Criar sala**, como sempre.
- **Os outros**: a sala aparece em **Salas na sua rede** em poucos segundos. Clique nela para entrar.

Se uma sala não aparecer, use o **Entrar por IP** com o endereço do anfitrião no ZeroTier. O anfitrião vê esse endereço ao lado do nome dele em **Members** no my.zerotier.com, ou nos detalhes da sala (**ⓘ** nos controles na parte de baixo da sala): passe o mouse sobre o endereço para ver todos; o do ZeroTier está na faixa definida no passo 1.

## Se algo não funcionar

| Problema | O que fazer |
|---|---|
| A rede diz *Requesting configuration* ou *Access denied* | O dono da rede ainda não marcou **Auth** para este computador. |
| A sala não aparece | Confira se o ZeroTier mostra a rede como **OK** nos dois computadores. Depois tente o **Entrar por IP** com o endereço do anfitrião no ZeroTier. No Windows, confira se a rede do ZeroTier está como *Privada* (*Configurações → Rede e Internet → Ethernet → a rede do ZeroTier → Tipo de perfil de rede*). |
| Entra na sala, mas o vídeo não começa | Normalmente é o firewall do Windows de quem compartilha: permita o ScreenShare em redes privadas (*Segurança do Windows → Firewall → Permitir um aplicativo*). Depois de 8 segundos o ScreenShare passa sozinho para a conexão TCP. |
| O vídeo trava ou atrasa muito | O ZeroTier pode estar passando o tráfego pelos servidores dele em vez de ligar vocês diretamente. Rode `zerotier-cli peers` num terminal (no Windows, como administrador): os seus amigos devem aparecer como **DIRECT**. Se aparecerem como **RELAY**, ligar o UPnP num dos roteadores, normalmente o do anfitrião, costuma resolver. Confira também os selos de estatística da transmissão e [a qualidade está baixa](troubleshooting.md#a-qualidade-está-baixa). |
| Estava tudo funcionando e parou | Um dos computadores pode ter saído da rede, ou o ZeroTier não está rodando. Abra o ZeroTier e confira se a rede está **OK**. |

Para problemas que não são do ZeroTier, veja a [solução de problemas](troubleshooting.md).

## Privacidade

- Com **Access Control: Private**, só os computadores que você aprovar ficam na rede. O ID da rede não é uma senha, mas compartilhe só com o seu grupo, para estranhos não pedirem para entrar. Desmarque **Auth** (ou apague o membro) para tirar alguém.
- O ZeroTier cifra tudo entre os computadores, e o vídeo e o chat do ScreenShare são cifrados por cima disso.
- Os servidores do ZeroTier ajudam os computadores a se encontrarem, e repassam o tráfego quando eles não conseguem se ligar diretamente. O ScreenShare em si continua sem usar nenhum serviço de fora: ele só conversa com as pessoas da sua sala.
