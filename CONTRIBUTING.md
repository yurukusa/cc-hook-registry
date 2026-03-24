# Contributing to cc-hook-registry

Want to add your hook to the registry? Here's how.

## Adding a Hook

1. Fork this repo
2. Edit `index.mjs` — add an entry to the `REGISTRY` array:

```javascript
{
  id: 'your-hook-name',
  name: 'Human-Readable Name',
  category: 'safety',  // safety, quality, approve, utility, monitoring, ux, framework, security
  source: 'your-github-user/repo',
  trigger: 'PreToolUse',  // PreToolUse, PostToolUse, Stop, SessionStart, Notification
  desc: 'One-line description of what it does',
  tags: ['keyword1', 'keyword2'],
  install: 'npx your-package or "git clone + copy"',
  stars: 100,  // optional: GitHub stars
  issue: '#12345',  // optional: related Claude Code issue
}
```

3. If your hook is a standalone bash script hosted on GitHub, add a `rawUrl` for direct install support
4. Submit a PR

## Categories

| Category | For hooks that... |
|----------|-------------------|
| safety | Block dangerous commands |
| quality | Check code quality, commits, syntax |
| approve | Auto-approve safe commands |
| utility | Cleanup, debugging, session management |
| monitoring | Track context, costs, usage |
| ux | Notifications, alerts |
| framework | Multi-hook frameworks |
| security | Prompt injection, access control |

## Requirements

- Hook must be publicly available (GitHub, npm, etc.)
- Hook must have a clear description
- Hook must work with Claude Code 2.1+
- No malicious code

## Testing

Run `bash test.sh` to verify your changes don't break existing functionality.
