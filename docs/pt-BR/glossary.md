# Glossário

Termos usados no código e nesta documentação. Os nomes em inglês são os que aparecem no código.

> **Idioma:** [English](../en-US/glossary.md) · Português (Brasil)

| Termo | Significado |
|---|---|
| **Adaptive controller** (controlador adaptativo) | `AdaptiveController` em `src/shared/quality.ts`. Sobe ou desce uma conexão na escada de qualidade conforme a perda, o RTT e a limitação de qualidade do WebRTC. |
| **Anfitrião** (*host*) | O participante cujo app roda o `RoomServer` da sala. Também é um participante que pode compartilhar e assistir. |
| **Assento** (*seat*) | O registro do servidor para um participante: conexão, transmissão, espectadores, prévia, foto. |
| **Avatar** (foto de perfil) | A foto de um participante: um data URL JPEG de 128 px, enviado com `set-avatar` e redistribuído como `avatar`. |
| **Banda de upload** (*upload budget*) | O limite total de upload de quem transmite, dividido entre os espectadores de forma justa max-min (`splitBudget`). |
| **clientId** | Um id aleatório criado na primeira execução e guardado nas configurações. Identifica uma instalação para as salas (usado na retomada e no banimento). |
| **Destaque** (*spotlight*) | O layout em que uma transmissão assistida fica grande e as outras ficam numa faixa. |
| **Escada / preset** (*ladder*) | A lista de níveis de qualidade (`QUALITY_PRESETS`): Native60, 1080p60, 720p60, 720p30, 480p30. |
| **Espectador** (*watcher*) | Um participante que está assistindo a transmissão de alguém. |
| **Fallback TCP** | O transporte de reserva quando o WebRTC não conecta: codificação com WebCodecs e pacotes repassados pelo WebSocket da sala. |
| **Impressão digital** (*fingerprint*) | O SHA-256 do certificado TLS do anfitrião. Anunciada por mDNS e fixada pelos espectadores. |
| **Limite de exibição** (*view limit*) | O que o espectador pede: a altura em que exibe a transmissão (ou o máximo que escolheu) e um limite opcional de fps. |
| **Loopback de dispositivo** (*endpoint loopback*) | Capturar tudo que um dispositivo de saída toca (loopback do WASAPI). |
| **mDNS / DNS-SD** | Descoberta de serviços por DNS multicast, usada para anunciar e encontrar salas (`_lanshare._tcp`). |
| **Participante** | Qualquer pessoa na sala, inclusive o anfitrião. |
| **Perfil (`--profile`)** | Uma opção de linha de comando que dá a uma instância do app sua própria pasta de configurações, para rodar várias instâncias no mesmo computador. |
| **Prévia** (*preview / snapshot*) | Um JPEG de 320 px de uma transmissão ao vivo, atualizado a cada 5 s, mostrado nos cartões. |
| **Process loopback** | Capturar o som do sistema menos uma árvore de processos (Windows 10 2004+). Usado para deixar o Discord de fora. |
| **Processo principal / renderer / preload** | O processo Node.js do Electron, a página Chromium em sandbox e a ponte entre os dois. |
| **Publisher** | O objeto do renderer que cuida do *seu* compartilhamento (`src/renderer/lib/publisher.ts`). |
| **Quem transmite** (*streamer*) | Um participante que está compartilhando a tela. |
| **RoomServer** | O servidor dentro do processo principal do anfitrião (`src/main/server.ts`). |
| **Sinalização** (*signaling*) | As mensagens de oferta/resposta/ICE do WebRTC que configuram uma conexão. Repassadas pelo servidor. |
| **Slot** | Um número pequeno (0–255) por participante. O servidor coloca o slot de quem transmite na frente dos pacotes do fallback TCP para os espectadores saberem para onde enviá-los. |
| **Subscription** (assinatura) | O objeto do renderer que assiste uma pessoa (`src/renderer/lib/subscription.ts`). |
| **Token de anfitrião** (*host token*) | Um segredo aleatório que prova ao servidor que a conexão é do app do próprio anfitrião. |
| **Token de retomada** (*resume token*) | Enviado no `welcome`. Permite que um cliente que caiu recupere o assento em até 30 s sem PIN. |
| **Versão do protocolo** | `PROTOCOL_VERSION`. Precisa ser igual para todos na sala. |
| **WatchManager** | O objeto do renderer que guarda todas as suas assinaturas (`src/renderer/lib/watches.ts`). |
