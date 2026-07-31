# ADR 007 — Identidade, ativação e credencial do dispositivo

## Status

Aceito no MAX-006.

## Contexto

O MAX-005 deu ao tablet uma linha em `devices`, mas nenhuma forma de provar
que uma requisição realmente vem daquele tablet — heartbeats reais exigiam
alguma noção de identidade e autenticação que o Android ainda não tinha. O
desafio: um tablet instalado num veículo não tem teclado físico confortável
nem, no primeiro boot, nenhuma conta de usuário associada; e o processo de
ativação precisa ser seguro o bastante para não virar a forma mais fácil de
forjar um dispositivo na frota.

## Decisão

**Ativação por código humano, de uso único.** O operador gera um código de 8
caracteres no painel (`generate_device_enrollment_code`), digita-o no
tablet; o código expira em 15 minutos, é hash-only no banco e revoga
automaticamente qualquer código pendente anterior do mesmo dispositivo.
Nenhum QR code, NFC ou par emparelhado neste marco — o alfabeto de 32
símbolos (sem `0/O/1/I/L`) já resolve o problema de digitação manual.

**Token opaco, nunca um JWT do Supabase Auth.** O dispositivo troca o código
por um token de 256 bits (`enroll_device`), armazenado como
`Authorization: Bearer` em toda chamada subsequente. Ele nunca aparece de
novo depois da resposta de ativação; o servidor só guarda o hash. Um tablet
não é um usuário do Supabase Auth — não precisa de sessão, refresh token ou
papel (`role`) de aplicação, só de uma prova estável de "sou este
dispositivo".

**O servidor deriva a identidade, o dispositivo nunca a declara.**
`device_id` sai do hash do token (`private.device_id_for_token`), nunca de
um campo que o cliente envia. Isso elimina a classe inteira de bug/ataque
"dispositivo alega ser outro dispositivo".

**RLS com zero políticas nas duas tabelas novas.** `device_enrollment_codes`
e `device_credentials` negam todo acesso direto, mesmo autenticado; o único
caminho é por funções `SECURITY DEFINER` que revalidam papel (para o painel)
ou são restritas a `service_role` (para a Edge Function). Ver
[DEVICE_SECURITY.md](../architecture/DEVICE_SECURITY.md) para o detalhe
completo.

**Falha de rede não é revogação.** Só uma resposta `401` explícita do
servidor limpa a credencial local. Isso foi decidido cedo porque a
alternativa óbvia — tratar timeout como "não autorizado, limpa tudo" — teria
desativado tablets reais toda vez que o veículo ficasse sem sinal.

## Consequências

- Um código vazado só é útil por 15 minutos e uma única vez; não há
  reaproveitamento nem replay.
- Perder o token local (reset de fábrica, app desinstalado) exige
  reativação com um novo código — não há recuperação, dos dois lados, por
  design; o custo é operacional (reativar fisicamente), não de segurança.
- Adicionar um segundo fator de ativação (QR code, provisionamento em massa)
  é aditivo: o código humano continua existindo como caminho de
  emergência/manual, não precisa ser removido.
- Qualquer endpoint novo de dispositivo entra pela mesma Edge Function
  autenticada por token, nunca por acesso direto do Android ao Postgres ou
  por uma nova tabela com `GRANT` direto para `authenticated`/`anon`.
