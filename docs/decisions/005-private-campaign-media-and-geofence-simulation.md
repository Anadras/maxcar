# ADR 005 — Mídia privada e simulação GEO no banco

## Status

Aceito no MAX-004.

## Contexto

O painel precisa enviar e pré-visualizar criativos sem expor o acervo, além de
demonstrar proximidade geográfica com as mesmas primitivas espaciais que serão
usadas no produto. A autorização não pode depender do nome fornecido pelo
usuário nem de cálculo isolado no navegador.

## Decisão

O bucket `campaign-media` permanece privado. Objetos usam UUID e um caminho
hierárquico por anunciante e campanha. RLS valida papel, posse e coerência do
caminho; previews usam signed URLs de curta duração. O servidor valida
assinatura, MIME, extensão e tamanho, e calcula SHA-256.

A simulação administrativa usa uma RPC `SECURITY INVOKER` com PostGIS. A
localização continua somente em `establishments.location`, e a função combina
distância com os requisitos básicos de agenda e ativação.

Triggers protegem a prontidão estrutural de campanhas ativas, inclusive contra
a desativação do último vínculo obrigatório.

## Consequências

- vazamento de uma signed URL tem janela limitada;
- o banco preserva RLS e invariantes mesmo fora da interface;
- uploads grandes atravessam o servidor no piloto, solução simples e
  auditável, mas que poderá migrar para upload assinado quando o volume exigir;
- o simulador é uma ferramenta administrativa, não o motor offline do tablet;
- exclusão física, transcodificação e sincronização de mídia permanecem fora do
  MAX-004.
