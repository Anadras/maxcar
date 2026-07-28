# MAXCAR — Storage de criativos

## Bucket e acesso

Criativos ficam no bucket privado `campaign-media`. O painel nunca usa URL
pública: a leitura para preview é feita com signed URL de 10 minutos. O upload
é autenticado e depende simultaneamente da autorização do servidor e das
políticas RLS em `storage.objects`.

Leitura é permitida a equipe autorizada e ao anunciante proprietário. Escrita é
restrita a `super_admin`, `admin` e `commercial`. Não há política de exclusão
física no MAX-004; a operação normal desativa o metadado para preservar
integridade e histórico.

## Caminho e vínculo

Todo objeto segue:

```text
advertisers/{advertiser_id}/campaigns/{campaign_id}/{uuid}.{ext}
```

O nome original nunca integra o caminho. Uma trigger valida que anunciante,
campanha, UUID e extensão correspondem ao metadado em
`campaign_creatives`. As políticas de Storage repetem essa verificação de
posse antes de aceitar o objeto.

## Validação e integridade

- imagens: JPEG, PNG ou WebP, até 10 MB;
- vídeos: MP4 ou WebM, até 50 MB;
- MP4/H.264 é a recomendação inicial para compatibilidade futura com Android;
- MIME, extensão e assinatura inicial do arquivo são validados;
- o servidor calcula SHA-256 sobre os bytes recebidos;
- tamanho e checksum persistidos serão usados pelo download/cache offline.

O limite de 50 MB também está configurado no bucket. O Server Action aceita
55 MB para acomodar o envelope do formulário. Não há transcodificação neste
marco; a duração informada é metadado operacional e deve ser conferida pelo
usuário.

O fluxo cria o metadado, envia o objeto e remove o metadado se o upload falhar.
Como não há exclusão física pela UI, uma falha rara depois do upload e antes da
resposta deve ser reconciliada operacionalmente. A sincronização do tablet e
suas credenciais próprias ficam para marcos posteriores.
