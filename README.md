# Crunchyroll

Plugin da Crunchyroll para o [Grayjay](https://grayjay.app), **testado no Android e no Desktop**.
Fork do plugin oficial da FUTO ([gitlab.futo.org/videostreaming/plugins/crunchyroll](https://gitlab.futo.org/videostreaming/plugins/crunchyroll)) com filtros de busca por idioma.

**Instalar:** `grayjay://plugin/https://raw.githubusercontent.com/mzramna/GrayjayCrunchyroll/main/CrunchyrollConfig.json`
(ou cole `https://raw.githubusercontent.com/mzramna/GrayjayCrunchyroll/main/CrunchyrollConfig.json` em *Sources → Add*).

## Melhorias

### Novas neste fork (sobre o oficial da FUTO v19)
- Filtros de busca (com apenas esta fonte selecionada):
  - **Idioma padrão**: "Áudio em …" / "Legenda em …" (usa *Audio Language* e *Subtitles/CC Language*).
  - **Buscar por**: Mídia (idiomas do episódio) ou Criador (idiomas da série).
  - **Áudio (dublagem)** e **Legenda**: todos os idiomas, incluindo pt-BR (qualquer um dos marcados).
  - Também aplicados na aba **Creators**.
- Paginação da busca continua mesmo quando uma página é toda filtrada.

### Sobre o plugin original do DeltaEvo (v3)
- **Grayjay Desktop** (com Widevine) e cliente HTTP compatível com Cloudflare (curl-impersonate).
- Reprodução DASH + Widevine com licença e registro de progresso.
- Busca de episódios e séries com paginação; home funcional.
- Configurações de idioma de exibição, áudio, legenda/CC e conteúdo premium.
- Sessão autenticada e perfis; legendas CC; capítulos para pular abertura/encerramento.
- Links localizados (`/pt-br/...`), episódios futuros e indisponíveis.

## Desenvolvimento
Cada mudança em uma branch; durante o teste o `sourceUrl` aponta para a branch e volta para a `main` no merge.

Licença: AGPL-3.0 (código original da FUTO).
