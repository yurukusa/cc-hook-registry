# cc-hook-registry

Search, browse, and install Claude Code hooks from the community.

```bash
npx cc-hook-registry search database
```

```
  Search: "database" — 1 result(s)

  block-database-wipe [safety]
    Blocks migrate:fresh, DROP DATABASE, prisma migrate reset
    Install: npx cc-safe-setup --install-example block-database-wipe
```

## Commands

```bash
npx cc-hook-registry search <keyword>   # Find hooks by keyword
npx cc-hook-registry browse [category]  # Browse by category
npx cc-hook-registry install <id>       # Install a hook
npx cc-hook-registry info <id>          # Show hook details
npx cc-hook-registry stats              # Registry statistics
```

## Categories

| Category | Hooks | What They Do |
|----------|-------|-------------|
| safety | 14 | Block destructive commands, protect files, secrets |
| quality | 4 | Syntax checks, commit quality, edit validation |
| utility | 3 | Cleanup, debugging, session handoff |
| monitoring | 2 | Context window, cost tracking |
| ux | 2 | Desktop notifications, sound alerts |
| framework | 2 | Python + TypeScript/Bun frameworks |
| approve | 1 | Auto-approve safe compound commands |
| security | 1 | Prompt injection defense |

## 29 Hooks

The registry includes hooks from:
- **cc-safe-setup** (22 hooks) — `npx cc-safe-setup`
- **claude-code-safety-net** (1,185★) — TypeScript safety hooks
- **karanb192/claude-code-hooks** (298★) — JavaScript safety
- **johnlindquist/claude-hooks** (329★) — TypeScript/Bun
- **claude-code-hooks-mastery** (3,386★) — Python framework
- **claude-hooks** by lasso-security — Prompt injection defense
- **awesome-claude-code** by pascalporedda — Sound notifications

## How It Works

The registry is a curated list embedded in the package. No server, no API calls, no network required. Install commands run `npx cc-safe-setup --install-example` for compatible hooks.

## Submit Your Hook

Want to add your hook to the registry? Open a PR on [GitHub](https://github.com/yurukusa/cc-hook-registry) adding an entry to the REGISTRY array in `index.mjs`.

## Related

- [cc-safe-setup](https://github.com/yurukusa/cc-safe-setup) — Install 8 safety hooks in one command
- [cc-hook-test](https://github.com/yurukusa/cc-hook-test) — Test runner for hooks
- [COOKBOOK](https://github.com/yurukusa/claude-code-hooks/blob/main/COOKBOOK.md) — 25 hook recipes

## License

MIT
