# Simplificação da experiência administrativa

## Objetivo

O painel deve permitir que uma pessoa sem experiência técnica coloque uma campanha no ar seguindo um caminho visível e curto:

1. cadastrar o cliente;
2. cadastrar o local;
3. criar a campanha;
4. enviar a imagem ou o vídeo;
5. colocar a campanha no ar;
6. confirmar a reprodução no tablet.

## Problemas encontrados

- A navegação principal expunha todas as divisões internas do produto com a mesma importância.
- O painel inicial mostrava muitos números e um mapa conceitual que podia ser confundido com localização real.
- O formulário de campanha expunha prioridade numérica, fuso UTC, limites e horários antes das informações essenciais.
- A publicação exigia editar o status e depois incluir a campanha na grade em ações separadas.
- Era possível incluir uma campanha de rascunho na grade. Ela parecia programada no painel, mas não entrava no manifesto do tablet porque o servidor entrega apenas campanhas ativas e prontas.
- A tela do tablet mostrava apenas “Conteúdo sendo preparado”, sem diferenciar grade vazia, download, falha de mídia ou campanha fora do horário.
- Um item sem URL de download podia permanecer pendente indefinidamente.

## Estrutura adotada

### Navegação principal

- Início
- Campanhas
- Clientes
- Tablets
- Relatórios

Cadastros operacionais e configurações continuam disponíveis, mas ficam agrupados em áreas secundárias. Nenhuma rota ou capacidade foi removida.

### Início

O painel inicial agora prioriza:

- campanhas no ar;
- tablets reproduzindo;
- itens que precisam de atenção;
- um checklist do primeiro anúncio;
- a situação real dos tablets.

O mapa conceitual foi removido porque não representava a posição real dos veículos.

### Campanhas

- Os termos técnicos foram substituídos por linguagem operacional.
- Configurações avançadas ficam recolhidas.
- Criativo passou a ser apresentado como “imagem ou vídeo”.
- A tela de detalhe mostra os passos que ainda faltam.
- A ação principal “Colocar no ar e sincronizar tablets” valida a campanha, ativa-a, inclui campanhas normais na grade e solicita sincronização.

## Prevenção da tela sem conteúdo

O painel não deve mais indicar que uma campanha está pronta apenas porque existe um vínculo com a grade. A publicação valida campanha, mídia e local GEO antes de ativar.

No Android, a tela de preparação agora informa uma causa útil e não técnica:

- aguardando programação;
- baixando conteúdo;
- conteúdo ainda em preparação;
- não foi possível preparar o conteúdo;
- aguardando o horário da campanha.

Arquivos sem endereço de download são marcados como falha, em vez de permanecerem pendentes para sempre.

## Capacidades preservadas

- auditoria e exclusão protegida;
- segurança e RLS;
- campanhas REGULAR e GEO;
- GPS, histerese, prioridade e cooldown;
- cache e reprodução offline;
- sincronização e comandos remotos;
- kiosk e modo manutenção;
- relatórios e cadastros completos.

## Fora deste trabalho

O manual operacional será produzido somente depois que o fluxo simplificado for validado no Black Shark.
