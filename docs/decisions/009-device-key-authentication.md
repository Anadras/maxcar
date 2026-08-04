# ADR 009 — Autenticação do dispositivo por chave criptográfica

## Status

Aceito no MAX-010.6. Substitui a parte "token opaco" do
[ADR 007](007-device-identity-and-enrollment.md) — o resto do ADR 007
(ativação por código humano, servidor deriva a identidade, RLS com zero
políticas, falha de rede não é revogação) continua valendo sem mudança,
só a natureza do que o dispositivo carrega mudou.

## Contexto

Um tablet físico do piloto (MAX-011) demonstrou uma instabilidade de
armazenamento séria e nunca totalmente diagnosticada: minutos depois de o
token de dispositivo ser gravado e confirmado com sucesso — inclusive
completando um heartbeat real com ele — a linha correspondente desaparecia
tanto das consultas do próprio app quanto de uma leitura externa do arquivo
do banco, com o mesmo processo do app continuamente vivo o tempo todo (sem
reinício de processo entre a escrita e o desaparecimento). Quatro correções
sucessivas na camada de armazenamento — trocar `EncryptedSharedPreferences`
por Room com criptografia via Keystore, trocar `journal_mode` de WAL para
TRUNCATE, desativar o matador de processos `com.mediatek.duraspeed`, e
corrigir um bug real de migração repetida — não resolveram o problema nesse
aparelho. Ver o histórico completo em
[ANDROID_ENROLLMENT.md](../architecture/ANDROID_ENROLLMENT.md#max-011-instabilidade-de-armazenamento-não-resolvida-num-tablet-físico).

Continuar investigando essa instabilidade específica de armazenamento
arriscava consumir tempo indefinidamente sem garantia de causa raiz
encontrável. A alternativa: eliminar a categoria inteira de problema —
"um segredo que precisa sobreviver intacto num arquivo local" — em vez de
continuar defendendo esse arquivo.

## Decisão

**A identidade do dispositivo é uma chave assimétrica, nunca mais um
segredo compartilhado.** O tablet gera um par de chaves EC P-256 dentro do
Android Keystore (`PURPOSE_SIGN`, não-exportável por construção da própria
API); a chave privada nunca é lida em bytes por nenhum código do app, nunca
serializada, nunca gravada em Room/DataStore/SharedPreferences. Cada
requisição é assinada (ECDSA P-256/SHA-256, formato raw IEEE P1363); o
servidor verifica a assinatura contra a chave pública já registrada. Ver
[DEVICE_KEY_AUTH.md](../architecture/DEVICE_KEY_AUTH.md) para o esquema
completo.

**O que precisa sobreviver localmente deixa de ser secreto.** O único
identificador local (`key_id`) não é segredo — perdê-lo não é perder a
identidade, porque a chave pública/fingerprint pode sempre ser recalculada
a partir do Keystore. Isso torna a identidade recuperável sem um novo
código de ativação, fechando exatamente a categoria de bug que motivou essa
mudança: mesmo que o registro local se perca de novo (por qualquer causa
parecida com a do MAX-011), a próxima tentativa de sincronização recupera o
`key_id` sozinha via um desafio assinado.

**Ponte para os RPCs existentes, não uma reescrita deles.** O Postgres não
verifica ECDSA nativamente; a Edge Function verifica a assinatura e emite um
token de sessão opaco de ~60s, na mesma forma dos tokens v1, que os RPCs
existentes continuam aceitando sem nenhuma mudança no próprio corpo. Só
`private.device_id_for_token` — o único ponto que todo RPC já chamava — foi
estendido para reconhecer os dois esquemas.

**Nunca apagar a chave automaticamente.** Um 401 do servidor (chave
desconhecida, revogada, assinatura inválida) só derruba o pareamento local
`key_id → device_id`, nunca a chave física no Keystore nem o histórico do
dispositivo. A recuperação automática do ciclo seguinte decide, sozinha, se
o problema era só o pareamento local (recupera) ou uma revogação de fato
(falha do mesmo jeito controlado que um fingerprint desconhecido).

**Coexistência temporária, sem caminho de volta.** O servidor aceita os dois
esquemas (v1 Bearer, v2 assinado) para não quebrar um dispositivo ainda não
atualizado; o Android desta versão em diante só fala v2 — não existe mais
código no app que leia ou grave um token estático. Um dispositivo migra na
próxima reativação (novo código), sem nenhuma lógica de auto-detecção ou
fallback no cliente.

## Consequências

- A superfície de "coisas que podem vazar e comprometer um dispositivo"
  fica menor: não há mais nenhum valor secreto que precise cruzar a rede ou
  ser lido de disco pelo app — só assinaturas, que provam posse sem revelar
  a chave.
- Perder o registro local do `key_id` (o equivalente ao que causou o
  MAX-011) deixa de ser um incidente que exige reativação manual — passa a
  ser transparente, resolvido pela recuperação automática no ciclo
  seguinte.
- `minSdk` do app Android subiu de 26 para 30, já que
  `SHA256withECDSAinP1363Format` só existe a partir da API 30; aceitável
  porque a frota piloto real roda Android 15 (API 35).
- O painel ganha um segundo card de autenticação
  (`device-key-identity-panel.tsx`), distinto do card de ativação por
  token — os dois esquemas nunca aparecem como se fossem a mesma coisa.
- Qualquer endpoint de dispositivo novo continua entrando pela mesma
  Edge Function autenticada, agora por assinatura em vez de Bearer; o
  padrão de "servidor deriva a identidade, nunca confia num campo que o
  cliente declara" do ADR 007 não muda.
