# pi-better-models

Pi extension — enhanced `/models` picker with **Artificial Analysis coding rank & score**.

## What it does

Registers a `/models` slash command that replaces Pi's built-in `/model` selector with a richer TUI picker. Each row shows the model id, routing provider, per-million-token cost, and an **Artificial Analysis Coding Index** score with a letter grade (A+ → F) when available. Context, pricing, and rating fields are configurable; by default the compact picker shows pricing + rating so the score remains visible. The list is sorted by coding score (best first), then alphabetically for unscored models. Fuzzy search filters the list as you type. `Tab` and `Shift+Tab` cycle next/previous model; `Enter` selects. Selecting a model switches the active model for the session.

Model metadata (context, cost, capabilities) is sourced from [modelgrep](https://modelgrep.com), which republishes Artificial Analysis benchmarks plus pricing/context/capabilities — no API key required. Registered Pi model `cost`/`contextWindow` fill gaps for private or gateway models not in the catalog. The **coding score/rank is the AA Coding Index**, computed locally among your available models (best pickable = #1).

### Optional: first-party Artificial Analysis fallback

modelgrep covers ~177 benched models. If you want the fuller set (~209 models with a coding index), set an Artificial Analysis API key and the picker fills coding scores that modelgrep is missing:

```bash
export ARTIFICIAL_ANALYSIS_API_KEY=aa_xxx   # get one at https://artificialanalysis.ai/login
```

(`AA_API_KEY` is accepted as an alias.) Without a key the extension works fully on modelgrep alone — the AA source is skipped, so keyless users pay nothing.

### Picker columns

The default compact layout is:

```text
pricing · coding rank & score (AA)
```

Change the visible fields with `PI_MODELS_COLUMNS`. Supported fields are `context`, `pricing`, and `score`:

```bash
# Default
export PI_MODELS_COLUMNS=pricing,score

# Show all available metadata
export PI_MODELS_COLUMNS=context,pricing,score

# Show only context and rating
export PI_MODELS_COLUMNS=context,score
```

Restart Pi after changing the environment variable.

## Install

```bash
# From npm (once published)
pi install npm:@ktappdev/pi-better-models

# From GitHub (pre-release)
pi install git:github.com/ktappdev/pi-better-models
```

## Data sources

| Source | Role | Key? | Cache |
| --- | --- | --- | --- |
| [modelgrep](https://modelgrep.com/api) `/api/v1/models?sort=coding` | Primary catalog: benchmarks, pricing, context, capabilities | No | `~/.cache/pi/modelgrep.json` (24h TTL) |
| [Artificial Analysis](https://artificialanalysis.ai/api-reference) `/api/v2/data/llms/models` | Coding-index fallback for models modelgrep doesn't score | Free key | `~/.cache/pi/aa.json` (24h TTL) |

Cache files are shared across Pi extensions — whichever loads first populates them; later loads read from disk. If a fetch fails, the last good cache is used.

## Source

[github.com/ktappdev/pi-better-models](https://github.com/ktappdev/pi-better-models)

## License

MIT © Ken Taylor
