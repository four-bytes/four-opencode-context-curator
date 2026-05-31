# @four-bytes/opencode-context-curator

**Status:** Sprint 2, geplant

Pre-Prompt-Hook, der Files vor dem Senden an den LLM curated: Statt full-file Context nur geänderte Blöcke + N=10 Kontext-Zeilen. Token-Budget-Steuerung mit konfigurierbarem Hard-Limit (default 8000).

## Zweck

Größter sofortiger Kosten-Hebel. Niedriger Aufwand (Hook-API), lernt opencode-Plugin-API an einem überschaubaren Fall.

## Lizenz

Apache-2.0

## Meta-Repo

[four-bytes/opencode-plugins](https://github.com/four-bytes/opencode-plugins)
