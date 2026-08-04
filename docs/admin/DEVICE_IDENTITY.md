# MAXCAR — Identidade do tablet no painel (MAX-010.6)

Como um operador vê e gerencia a autenticação de um tablet no painel, sem
nunca precisar entender ECDSA ou Android Keystore. Para o esquema técnico
por trás, veja [DEVICE_KEY_AUTH.md](../architecture/DEVICE_KEY_AUTH.md); para
o fluxo de ativação em si, veja
[ANDROID_ENROLLMENT.md](../architecture/ANDROID_ENROLLMENT.md).

## Dois cards, dois esquemas

`/dispositivos/[id]` mostra até dois cards de autenticação — um dispositivo
só usa um esquema por vez, nunca os dois simultaneamente:

- **"Ativação do tablet"** — gera e revoga o código humano-digitável de
  ativação, e mostra o estado do esquema mais antigo (token estático), se
  ainda em uso.
- **"Autenticação do tablet"** — mostra o estado da identidade por chave
  criptográfica (o esquema atual). Nunca exibe a chave pública nem qualquer
  material relacionado à chave privada — só o suficiente para um operador
  julgar a saúde da identidade e agir sobre ela.

## O que o card "Autenticação do tablet" mostra

| Campo                        | Significado |
| ----------------------------- | ----------- |
| Estado                        | "Ativa" (existe uma chave não revogada) ou "Sem identidade por chave" |
| Tipo                          | O algoritmo (sempre EC P-256/SHA-256 hoje) |
| Proteção                      | Se a chave está dentro do hardware seguro do aparelho ou só em software |
| Identidade preservada desde   | Quando a chave atual foi ativada |
| Último uso                    | A última vez que uma requisição assinada com essa chave foi aceita |

Quando não há chave ativa, o card indica se é porque o tablet nunca foi
ativado, ou porque ele ainda está no esquema anterior (token estático) —
nesse segundo caso, nenhuma ação é necessária: o tablet migra sozinho para
o esquema por chave na próxima vez que for reativado com um novo código
(o mesmo processo de qualquer atualização de aparelho).

## Ações disponíveis

- **Gerar código de ativação** (no card "Ativação do tablet") — o mesmo
  código serve para uma primeira ativação por chave ou para uma
  reativação. Exibido em texto puro **uma única vez**; o painel nunca
  volta a mostrá-lo.
- **Revogar identidade** (no card "Autenticação do tablet", só aparece com
  uma chave ativa) — chama `revoke_device_key`. O tablet perde a
  capacidade de sincronizar imediatamente; ele tenta se recuperar
  sozinho a cada ciclo (ver
  [DEVICE_KEY_AUTH.md](../architecture/DEVICE_KEY_AUTH.md#recuperação-identidade-sem-um-novo-código)),
  mas como a chave foi de fato revogada, essa tentativa falha do mesmo
  jeito controlado que qualquer chave desconhecida — o tablet só volta a
  funcionar com um novo código de ativação gerado aqui.

Não existe uma ação "ver chave pública" ou "exportar identidade" no painel
— por design: a chave pública sozinha não é secreta, mas não tem nenhum uso
legítimo fora do par nonce/assinatura de uma requisição real, então
expô-la no painel só aumentaria a superfície de cópia/log sem nenhum
benefício operacional.

## Quando um tablet parece "preso"

Se um tablet mostra `credentialMissingLocally` no diagnóstico local (tela
"Reativar este tablet" no próprio Android) mas o card "Autenticação do
tablet" no painel ainda mostra uma chave ativa, o problema é local ao
aparelho (a chave do Keystore em si desapareceu — reset de fábrica,
desinstalação, ou uma falha de hardware) e a única saída é uma reativação
com um novo código. Se o painel já mostra "Sem identidade por chave", a
identidade foi revogada (por uma ação aqui, ou porque a recuperação
automática do tablet já esgotou suas tentativas contra uma chave que não é
mais válida) — o mesmo remédio, um novo código, resolve os dois casos.
