# Appvision Claude Code plugins

A [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugins/marketplaces). Add it once,
then install the plugins you want.

| Plugin | What it does |
| --- | --- |
| [eraser-diagrams](plugins/eraser-diagrams) | Draws architecture diagrams, flowcharts, swimlanes and ERDs, and renders them to PNG on your machine with Eraser's open-source engine. |

## Install

In Claude Code:

```text
/plugin marketplace add appvision-ai/claude-plugins
/plugin install eraser-diagrams@appvision
```

Or from a shell:

```bash
claude plugin marketplace add appvision-ai/claude-plugins
claude plugin install eraser-diagrams@appvision
```

Claude Code clones the repository with `git`. If the add fails on a machine without a GitHub SSH
key, set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` and try again.

Each plugin's README lists what else it needs.

## Updates

Marketplaces you add yourself do not update on their own. Either:

- run `/plugin marketplace update appvision` when a new version is announced, or
- turn on auto-update once: `/plugin` → **Marketplaces** → **appvision** → **Enable auto-update**.

## Turn a plugin on for everyone in a repository

Commit this to the repository's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "appvision": {
      "source": { "source": "github", "repo": "appvision-ai/claude-plugins" }
    }
  },
  "enabledPlugins": {
    "eraser-diagrams@appvision": true
  }
}
```

Anyone who opens the repository in Claude Code and accepts the folder-trust prompt gets the plugin,
with no separate install step.

## Adding a plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json` and the plugin's `skills/`, `commands/` or
   `agents/` beside it.
2. Add an entry to [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) with
   `"source": "./plugins/<name>"`.
3. Run `claude plugin validate .` and `claude plugin validate ./plugins/<name>`.
4. Try it without installing: `claude --plugin-dir ./plugins/<name>`.

To ship a change to an existing plugin, **bump `version` in its `plugin.json`**. Users who already
have the plugin keep their cached copy until the version string changes.

## Licence

[MIT](LICENSE).
