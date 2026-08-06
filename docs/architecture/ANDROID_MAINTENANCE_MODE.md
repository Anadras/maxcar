# MAXCAR — PIN e modo manutenção (MAX-010)

Como um técnico entra no diagnóstico sem deixar o gesto oculto ser a única
barreira, e o que acontece enquanto o tablet está em manutenção. Para as
camadas de kiosk que a saída realmente desliga, veja
[ANDROID_KIOSK.md](ANDROID_KIOSK.md).

## Fluxo

```
5 toques no canto (PlayerViewModel.onDiagnosticTap)
  → abre MaintenancePinDialog (nunca entra direto)
  → MaintenanceAccessController.attemptUnlock(pin)
      PIN correto  → diagnóstico abre, tentativas zeradas, log "maintenance_entered"
      PIN errado   → mensagem com tentativas restantes
      Bloqueado    → mensagem com horário de liberação
      Sem PIN configurado → mensagem pedindo contato com o administrador
  → "Voltar ao player" → log "maintenance_exited"
```

O gesto (`PlayerScreen`) e o diálogo (`MaintenancePinDialog`) são só a UI;
toda a decisão de autorização vive em
`kiosk/MaintenanceAccessController.kt` e `kiosk/PinValidator.kt` —
nenhuma outra tela do app pode abrir o diagnóstico sem passar por eles.

## O PIN em si

- **Definido pelo super_admin** no painel (`set_device_maintenance_pin`
  RPC, card "Kiosk e manutenção" no detalhe do dispositivo) — 4 a 8
  dígitos, nunca reaproveita a senha da conta do painel.
- **Nunca a senha do painel**: são sistemas de autenticação completamente
  separados — o PIN só existe para este propósito local.
- **Hash reproduzível offline**: o servidor grava
  `sha256(pin || salt)` (`devices.maintenance_pin_hash/salt`) e entrega
  ambos ao tablet via `get_device_config` — o Android recalcula o mesmo
  hash localmente (`PinValidator.matches`) para comparar, nunca precisando
  de rede no momento da validação. Um PIN de 4-8 dígitos é
  inerentemente vulnerável a força bruta offline dado acesso físico ao
  hash armazenado — a defesa real é o bloqueio por tentativas abaixo, não
  a força do hash.
- **Nunca logado**: em nenhum ponto (Android ou servidor) o PIN em texto
  puro é gravado em log, banco ou evento de auditoria — só o hash, e só o
  fato de "o PIN foi alterado" (`audit_events`, ação
  `set_maintenance_pin`, nunca o antes/depois).
- **Sem PIN configurado ⇒ acesso continua bloqueado.** Nunca há um
  fallback "sem PIN, deixa entrar".

## Bloqueio por tentativas

`MaintenanceAccessController` — puramente local (`AppPreferences`), já que
o veículo pode estar sem sinal quando um operador precisa de acesso:

- 5 tentativas incorretas seguidas → bloqueio de 5 minutos
  (`MAX_ATTEMPTS`, `LOCKOUT_DURATION_MILLIS`).
- O contador zera só com um PIN correto — nunca com o tempo passando
  sozinho antes do bloqueio disparar.
- O estado de bloqueio sobrevive a reinício do app/processo (persistido em
  DataStore, não em memória) — reabrir o app não reseta a tentativa.

## O que "modo manutenção" realmente é

Não é uma tela nova: é a tela de diagnóstico já existente desde o MAX-006
(`DeviceHomeScreen`), agora só alcançável via PIN. Uma vez dentro:

- Lock Task é liberado (`lockTaskEligible` fica `false` enquanto
  `showDiagnostics = true` — ver [ANDROID_KIOSK.md](ANDROID_KIOSK.md)).
- Sincronizar agora, testar conexão, ver contagem de mídia pronta —
  ferramentas já existentes, sem nada removido.
- "Voltar ao player" retoma o modo operacional normal (imersivo, e Lock
  Task de novo se ainda elegível).
- **MAX-011**: entrar aqui também arma o mesmo temporizador de retorno
  automático que `disable_kiosk_temporarily` usa (ver
  [ANDROID_KIOSK.md](ANDROID_KIOSK.md#saída-temporária-com-retorno-automático-max-011))
  — um banner mostra a contagem regressiva, e o app volta ao player
  sozinho se ninguém tocar "Voltar ao player" antes do prazo (padrão 5
  min, configurável por dispositivo). Isto é novo: antes deste marco, um
  técnico que esquecesse o tablet aberto em diagnóstico o deixava fora do
  Lock Task indefinidamente.

## Comando remoto de manutenção

`enter_maintenance`/`exit_maintenance` (MAX-009,
[DEVICE_COMMANDS.md](../admin/DEVICE_COMMANDS.md)) só ligam/desligam a
flag local `AppPreferences.maintenanceRequested` — **não abrem a tela de
diagnóstico sozinhos**. A flag existe para uma futura UI que peça
confirmação local antes de entrar remotamente em manutenção; neste marco,
ela é gravada e reportável, mas a única forma real de abrir o diagnóstico
continua sendo o gesto + PIN físicos no tablet — um comando remoto nunca
contorna essa exigência.

`disable_kiosk_temporarily`/`reenter_kiosk`/`enable_kiosk` (MAX-011) são
deliberadamente um mecanismo **separado**: soltam o Lock Task remotamente
sem abrir diagnóstico, preservando a mesma regra acima — ver
[ANDROID_KIOSK.md](ANDROID_KIOSK.md#saída-temporária-com-retorno-automático-max-011).

## Registro de entrada/saída

Não existe uma tabela dedicada: `MaintenanceAccessController.attemptUnlock`
e `logExit` gravam apenas via `android.util.Log` (nunca o PIN), e o
heartbeat já reporta `operational_status = 'maintenance'` enquanto a tela
de diagnóstico está aberta — a combinação já responde "quando" sem uma
tabela nova para manter sincronizada.
