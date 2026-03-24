#!/usr/bin/env node

/**
 * cc-hook-registry — Search, browse, and install Claude Code hooks from the community
 *
 * Usage:
 *   npx cc-hook-registry search <keyword>     Find hooks by keyword
 *   npx cc-hook-registry browse [category]    Browse all hooks by category
 *   npx cc-hook-registry install <id>         Install a hook from the registry
 *   npx cc-hook-registry info <id>            Show hook details
 *   npx cc-hook-registry submit               Submit your hook to the registry
 *   npx cc-hook-registry stats                Registry statistics
 *
 * The registry is a JSON file hosted on GitHub. No server needed.
 * Hooks are fetched directly from their source repositories.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const HOME = homedir();
const HOOKS_DIR = join(HOME, '.claude', 'hooks');
const SETTINGS_PATH = join(HOME, '.claude', 'settings.json');
const CACHE_PATH = join(HOME, '.claude', 'hook-registry-cache.json');
const CACHE_TTL = 3600000; // 1 hour

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

// Registry: curated list of hooks from the community
// This is the "database" — stored as a constant, updated via npm releases
const REGISTRY = [
  // cc-safe-setup built-in hooks
  { id: 'destructive-guard', name: 'Destructive Command Blocker', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Blocks rm -rf /, git reset --hard, git clean, PowerShell Remove-Item', tags: ['rm', 'delete', 'reset', 'clean'], install: 'npx cc-safe-setup' },
  { id: 'branch-guard', name: 'Branch Push Protector', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Blocks push to main/master and force-push on all branches', tags: ['git', 'push', 'force', 'main'], install: 'npx cc-safe-setup' },
  { id: 'secret-guard', name: 'Secret Leak Prevention', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Blocks git add .env, credential files', tags: ['env', 'secret', 'credential', 'key'], install: 'npx cc-safe-setup' },
  { id: 'syntax-check', name: 'Post-Edit Syntax Validator', category: 'quality', source: 'cc-safe-setup', trigger: 'PostToolUse', desc: 'Checks Python/Shell/JSON/YAML/JS syntax after edits', tags: ['syntax', 'python', 'json', 'lint'], install: 'npx cc-safe-setup' },
  { id: 'context-monitor', name: 'Context Window Monitor', category: 'monitoring', source: 'cc-safe-setup', trigger: 'PostToolUse', desc: 'Graduated warnings at 40%/25%/20%/15% context remaining', tags: ['context', 'memory', 'compact'], install: 'npx cc-safe-setup' },

  // cc-safe-setup examples
  { id: 'block-database-wipe', name: 'Database Wipe Protection', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Blocks migrate:fresh, DROP DATABASE, prisma migrate reset', tags: ['database', 'migrate', 'drop', 'prisma', 'laravel', 'django', 'rails'], install: 'npx cc-safe-setup --install-example block-database-wipe', issue: '#37405' },
  { id: 'compound-command-approver', name: 'Compound Command Approver', category: 'approve', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Auto-approve safe compound commands (cd && git log) that permissions cant match', tags: ['compound', 'cd', 'permission', 'approve'], install: 'npx cc-safe-setup --install-example compound-command-approver', issue: '#30519' },
  { id: 'case-sensitive-guard', name: 'Case-Insensitive FS Guard', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Detect exFAT/NTFS case collisions before rm/mkdir', tags: ['exfat', 'ntfs', 'case', 'filesystem'], install: 'npx cc-safe-setup --install-example case-sensitive-guard', issue: '#37875' },
  { id: 'tmp-cleanup', name: 'Temp File Cleanup', category: 'utility', source: 'cc-safe-setup', trigger: 'Stop', desc: 'Clean up /tmp/claude-*-cwd files on session end', tags: ['tmp', 'cleanup', 'leak', 'memory'], install: 'npx cc-safe-setup --install-example tmp-cleanup', issue: '#8856' },
  { id: 'loop-detector', name: 'Command Loop Detector', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Detect and break command repetition loops (warn at 3, block at 5)', tags: ['loop', 'repeat', 'infinite'], install: 'npx cc-safe-setup --install-example loop-detector' },
  { id: 'session-handoff', name: 'Session State Handoff', category: 'utility', source: 'cc-safe-setup', trigger: 'Stop', desc: 'Auto-save git state and session info for next session', tags: ['session', 'handoff', 'compact', 'resume'], install: 'npx cc-safe-setup --install-example session-handoff' },
  { id: 'cost-tracker', name: 'Session Cost Estimator', category: 'monitoring', source: 'cc-safe-setup', trigger: 'PostToolUse', desc: 'Estimate session token cost and warn at thresholds', tags: ['cost', 'token', 'money', 'budget'], install: 'npx cc-safe-setup --install-example cost-tracker' },
  { id: 'diff-size-guard', name: 'Mega-Commit Guard', category: 'quality', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Warn/block when committing too many files at once', tags: ['commit', 'diff', 'large', 'review'], install: 'npx cc-safe-setup --install-example diff-size-guard' },
  { id: 'hook-debug-wrapper', name: 'Hook Debug Wrapper', category: 'utility', source: 'cc-safe-setup', trigger: 'Any', desc: 'Wrap any hook to log input/output/exit/timing', tags: ['debug', 'log', 'test', 'wrapper'], install: 'npx cc-safe-setup --install-example hook-debug-wrapper' },
  { id: 'dependency-audit', name: 'Dependency Audit', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Warn when installing packages not in manifest', tags: ['npm', 'pip', 'cargo', 'install', 'supply-chain'], install: 'npx cc-safe-setup --install-example dependency-audit' },
  { id: 'deploy-guard', name: 'Deploy Without Commit Guard', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Block deploy commands when uncommitted changes exist', tags: ['deploy', 'vercel', 'netlify', 'firebase'], install: 'npx cc-safe-setup --install-example deploy-guard', issue: '#37314' },
  { id: 'protect-dotfiles', name: 'Dotfile Protector', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Block modifications to ~/.bashrc, ~/.aws/, ~/.ssh/', tags: ['dotfiles', 'bashrc', 'aws', 'ssh', 'config'], install: 'npx cc-safe-setup --install-example protect-dotfiles', issue: '#37478' },
  { id: 'scope-guard', name: 'Project Scope Guard', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Block file operations outside project directory', tags: ['scope', 'path', 'directory', 'escape'], install: 'npx cc-safe-setup --install-example scope-guard', issue: '#36233' },
  { id: 'notify-waiting', name: 'Desktop Notification', category: 'ux', source: 'cc-safe-setup', trigger: 'Notification', desc: 'Desktop notification when Claude waits for input', tags: ['notification', 'desktop', 'alert', 'waiting'], install: 'npx cc-safe-setup --install-example notify-waiting' },
  { id: 'read-before-edit', name: 'Read Before Edit Warning', category: 'quality', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Warn when editing files not recently read', tags: ['read', 'edit', 'mismatch', 'old_string'], install: 'npx cc-safe-setup --install-example read-before-edit' },
  { id: 'commit-quality-gate', name: 'Commit Message Quality', category: 'quality', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Warn on vague commit messages and long subjects', tags: ['commit', 'message', 'quality', 'conventional'], install: 'npx cc-safe-setup --install-example commit-quality-gate' },

  // cc-safe-setup — additional examples
  { id: 'allowlist', name: 'Allowlist (Inverse Permission)', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Block everything not explicitly approved', tags: ['allowlist', 'whitelist', 'inverse'], install: 'npx cc-safe-setup --install-example allowlist' },
  { id: 'auto-approve-build', name: 'Auto-Approve Build/Test', category: 'approve', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Auto-approve npm/cargo/go build, test, lint commands', tags: ['build', 'test', 'lint', 'npm', 'cargo'], install: 'npx cc-safe-setup --install-example auto-approve-build' },
  { id: 'auto-approve-docker', name: 'Auto-Approve Docker', category: 'approve', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Auto-approve docker build, compose, ps, logs', tags: ['docker', 'compose', 'container'], install: 'npx cc-safe-setup --install-example auto-approve-docker' },
  { id: 'auto-approve-git-read', name: 'Auto-Approve Git Read', category: 'approve', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Auto-approve git status/log/diff even with -C flags', tags: ['git', 'read', 'status', 'log'], install: 'npx cc-safe-setup --install-example auto-approve-git-read' },
  { id: 'auto-approve-python', name: 'Auto-Approve Python', category: 'approve', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Auto-approve pytest, mypy, ruff, black, isort', tags: ['python', 'pytest', 'lint', 'format'], install: 'npx cc-safe-setup --install-example auto-approve-python' },
  { id: 'auto-approve-ssh', name: 'Auto-Approve SSH', category: 'approve', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Auto-approve safe SSH commands (uptime, whoami)', tags: ['ssh', 'remote', 'server'], install: 'npx cc-safe-setup --install-example auto-approve-ssh' },
  { id: 'auto-checkpoint', name: 'Auto-Checkpoint', category: 'recovery', source: 'cc-safe-setup', trigger: 'PostToolUse', desc: 'Auto-commit after edits for rollback protection', tags: ['checkpoint', 'commit', 'rollback', 'recovery'], install: 'npx cc-safe-setup --install-example auto-checkpoint' },
  { id: 'auto-snapshot', name: 'Auto-Snapshot', category: 'recovery', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Save file copies before edits', tags: ['snapshot', 'backup', 'rollback'], install: 'npx cc-safe-setup --install-example auto-snapshot' },
  { id: 'session-checkpoint', name: 'Session Checkpoint', category: 'recovery', source: 'cc-safe-setup', trigger: 'PreCompact', desc: 'Save session state before context compaction', tags: ['session', 'compact', 'state'], install: 'npx cc-safe-setup --install-example session-checkpoint' },
  { id: 'branch-name-check', name: 'Branch Name Check', category: 'quality', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Warn on non-conventional branch names', tags: ['branch', 'naming', 'convention'], install: 'npx cc-safe-setup --install-example branch-name-check' },
  { id: 'commit-message-check', name: 'Commit Message Check', category: 'quality', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Warn on non-conventional commit messages', tags: ['commit', 'message', 'conventional'], install: 'npx cc-safe-setup --install-example commit-message-check' },
  { id: 'edit-guard', name: 'Edit Guard', category: 'quality', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Block Edit/Write to protected files', tags: ['edit', 'write', 'protected'], install: 'npx cc-safe-setup --install-example edit-guard' },
  { id: 'enforce-tests', name: 'Enforce Tests', category: 'quality', source: 'cc-safe-setup', trigger: 'PostToolUse', desc: 'Warn when source files change without test files', tags: ['tests', 'enforce', 'quality'], install: 'npx cc-safe-setup --install-example enforce-tests' },
  { id: 'large-file-guard', name: 'Large File Guard', category: 'quality', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Warn when Write creates files over 500KB', tags: ['large', 'file', 'size'], install: 'npx cc-safe-setup --install-example large-file-guard' },
  { id: 'todo-check', name: 'TODO Check', category: 'quality', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Warn when committing files with TODO/FIXME markers', tags: ['todo', 'fixme', 'hack'], install: 'npx cc-safe-setup --install-example todo-check' },
  { id: 'verify-before-commit', name: 'Verify Before Commit', category: 'quality', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Block commit unless tests passed recently', tags: ['verify', 'test', 'commit'], install: 'npx cc-safe-setup --install-example verify-before-commit' },
  { id: 'symlink-guard', name: 'Symlink Traversal Guard', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Detect symlink/junction traversal in rm targets', tags: ['symlink', 'junction', 'ntfs', 'traversal'], install: 'npx cc-safe-setup --install-example symlink-guard', issue: '#36339' },
  { id: 'binary-file-guard', name: 'Binary File Guard', category: 'quality', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Warn when Write targets binary file types', tags: ['binary', 'image', 'archive'], install: 'npx cc-safe-setup --install-example binary-file-guard' },
  { id: 'stale-branch-guard', name: 'Stale Branch Guard', category: 'quality', source: 'cc-safe-setup', trigger: 'PostToolUse', desc: 'Warn when branch is far behind default', tags: ['branch', 'stale', 'behind', 'rebase'], install: 'npx cc-safe-setup --install-example stale-branch-guard' },
  { id: 'reinject-claudemd', name: 'Re-inject CLAUDE.md', category: 'utility', source: 'cc-safe-setup', trigger: 'SessionStart', desc: 'Remind CLAUDE.md rules after compaction', tags: ['claudemd', 'compact', 'rules', 'memory'], install: 'npx cc-safe-setup --install-example reinject-claudemd', issue: '#6354' },
  { id: 'no-sudo-guard', name: 'No Sudo Guard', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Block all sudo commands', tags: ['sudo', 'root', 'privilege'], install: 'npx cc-safe-setup --install-example no-sudo-guard' },
  { id: 'no-install-global', name: 'No Global Install', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Block npm -g and system-wide pip', tags: ['npm', 'pip', 'global', 'system'], install: 'npx cc-safe-setup --install-example no-install-global' },
  { id: 'git-tag-guard', name: 'Git Tag Guard', category: 'quality', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Block pushing all tags at once', tags: ['git', 'tag', 'version', 'release'], install: 'npx cc-safe-setup --install-example git-tag-guard' },
  { id: 'npm-publish-guard', name: 'NPM Publish Guard', category: 'quality', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Version check before npm publish', tags: ['npm', 'publish', 'version'], install: 'npx cc-safe-setup --install-example npm-publish-guard' },

  // External projects
  { id: 'safety-net', name: 'Safety Net (Full Suite)', category: 'safety', source: 'kenryu42/claude-code-safety-net', trigger: 'PreToolUse', desc: 'TypeScript safety hooks with configurable severity levels', tags: ['typescript', 'safety', 'configurable'], install: 'npx @anthropic-ai/claude-code-safety-net', stars: 1185 },
  { id: 'hooks-mastery', name: 'Hooks Mastery (Python)', category: 'framework', source: 'disler/claude-code-hooks-mastery', trigger: 'All', desc: 'Python hooks covering all hook events + LLM integration', tags: ['python', 'mastery', 'all-events', 'llm'], install: 'git clone + copy', stars: 3386 },
  { id: 'prompt-injection-defender', name: 'Prompt Injection Defender', category: 'security', source: 'lasso-security/claude-hooks', trigger: 'PreToolUse', desc: 'YAML-based prompt injection pattern matching', tags: ['prompt-injection', 'security', 'yaml'], install: 'git clone + install.sh', stars: 161 },

  // karanb192/claude-code-hooks
  { id: 'karanb192-block-dangerous', name: 'Block Dangerous (JS)', category: 'safety', source: 'karanb192/claude-code-hooks', trigger: 'PreToolUse', desc: 'JavaScript safety hooks with configurable safety levels (critical/high/strict)', tags: ['javascript', 'safety', 'configurable', 'levels'], install: 'copy hook-scripts/', stars: 298 },
  { id: 'karanb192-protect-secrets', name: 'Protect Secrets (JS)', category: 'safety', source: 'karanb192/claude-code-hooks', trigger: 'PreToolUse', desc: 'JavaScript hook blocking Read/Edit/Write of sensitive files', tags: ['javascript', 'secrets', 'files', 'read'], install: 'copy hook-scripts/', stars: 298 },

  // johnlindquist/claude-hooks
  { id: 'johnlindquist-hooks', name: 'Claude Hooks (Bun/TS)', category: 'framework', source: 'johnlindquist/claude-hooks', trigger: 'All', desc: 'TypeScript hooks with Bun runtime, notification and session tracking', tags: ['typescript', 'bun', 'notification', 'session'], install: 'bun install', stars: 329 },

  // pascalporedda/awesome-claude-code
  { id: 'sound-notification', name: 'Sound Notification', category: 'ux', source: 'pascalporedda/awesome-claude-code', trigger: 'Notification', desc: 'Play audio alerts when Claude needs attention or completes a task', tags: ['sound', 'audio', 'notification', 'alert'], install: 'git clone + copy', stars: 73 },

  // cc-safe-setup additional examples
  { id: 'env-source-guard', name: 'Env Source Guard', category: 'safety', source: 'cc-safe-setup', trigger: 'PreToolUse', desc: 'Block sourcing .env files into shell environment', tags: ['env', 'source', 'bash', 'environment'], install: 'npx cc-safe-setup --install-example env-source-guard', issue: '#401' },
];

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(`
  cc-hook-registry — Find and install Claude Code hooks

  Commands:
    search <keyword>     Find hooks (e.g. "database", "git", "deploy")
    browse [category]    Browse by category (safety, quality, approve, utility, monitoring, ux)
    install <id>         Install a hook
    info <id>            Show hook details
    recommend            Recommend hooks for current project
    init                 Interactive setup — install recommended hooks
    list                 List all installed hooks with status
    update [id]          Update one or all installed hooks
    uninstall <id>       Remove an installed hook
    outdated             Check installed hooks for updates
    stats                Registry statistics

  Examples:
    npx cc-hook-registry search database
    npx cc-hook-registry browse safety
    npx cc-hook-registry install block-database-wipe
    npx cc-hook-registry info compound-command-approver
`);
  process.exit(0);
}

if (command === 'search') {
  const query = args.slice(1).join(' ').toLowerCase();
  if (!query) { console.log(c.red + '  Usage: cc-hook-registry search <keyword>' + c.reset); process.exit(1); }

  const results = REGISTRY.filter(h =>
    h.name.toLowerCase().includes(query) ||
    h.desc.toLowerCase().includes(query) ||
    h.tags.some(t => t.includes(query)) ||
    h.id.includes(query)
  );

  console.log();
  console.log(c.bold + '  Search: "' + query + '"' + c.reset + ' — ' + results.length + ' result(s)');
  console.log();

  if (results.length === 0) {
    console.log(c.dim + '  No hooks found. Try a different keyword.' + c.reset);
  } else {
    for (const h of results) {
      console.log('  ' + c.green + h.id + c.reset + c.dim + ' [' + h.category + ']' + c.reset);
      console.log('    ' + h.desc);
      console.log('    ' + c.dim + 'Install: ' + h.install + c.reset);
      console.log();
    }
  }
}

else if (command === 'browse') {
  const cat = args[1]?.toLowerCase();
  const categories = {};
  for (const h of REGISTRY) {
    if (cat && h.category !== cat) continue;
    if (!categories[h.category]) categories[h.category] = [];
    categories[h.category].push(h);
  }

  console.log();
  console.log(c.bold + '  Claude Code Hooks Registry' + c.reset + ' — ' + REGISTRY.length + ' hooks');
  console.log();

  for (const [category, hooks] of Object.entries(categories)) {
    console.log('  ' + c.bold + c.blue + category.charAt(0).toUpperCase() + category.slice(1) + c.reset + ' (' + hooks.length + ')');
    for (const h of hooks) {
      const stars = h.stars ? ' ' + h.stars + '★' : '';
      console.log('    ' + c.green + h.id.padEnd(28) + c.reset + h.desc.slice(0, 50) + stars);
    }
    console.log();
  }
}

else if (command === 'install') {
  const id = args[1];
  if (!id) { console.log(c.red + '  Usage: cc-hook-registry install <id>' + c.reset); process.exit(1); }

  const hook = REGISTRY.find(h => h.id === id);
  if (!hook) {
    console.log(c.red + '  Hook not found: ' + id + c.reset);
    console.log(c.dim + '  Use "cc-hook-registry search" to find hooks.' + c.reset);
    process.exit(1);
  }

  console.log();
  console.log(c.bold + '  Installing: ' + hook.name + c.reset);
  console.log(c.dim + '  ' + hook.desc + c.reset);
  console.log();
  console.log('  Run: ' + c.bold + hook.install + c.reset);
  console.log();

  if (hook.install.startsWith('npx cc-safe-setup')) {
    // Try direct download first (no cc-safe-setup dependency)
    const exampleName = hook.install.match(/--install-example\s+(\S+)/)?.[1];
    if (exampleName) {
      const rawUrl = `https://raw.githubusercontent.com/yurukusa/cc-safe-setup/main/examples/${exampleName}.sh`;
      const hookPath = join(HOME, '.claude', 'hooks', exampleName + '.sh');
      try {
        mkdirSync(join(HOME, '.claude', 'hooks'), { recursive: true });
        const script = execSync(`curl -sL "${rawUrl}"`, { encoding: 'utf-8' });
        if (script.startsWith('#!/bin/bash')) {
          writeFileSync(hookPath, script);
          chmodSync(hookPath, 0o755);

          // Auto-register in settings.json
          const trigger = script.includes('PreToolUse') ? 'PreToolUse' :
                         script.includes('PostToolUse') ? 'PostToolUse' :
                         script.includes('Stop') ? 'Stop' : 'PreToolUse';
          const matcher = script.includes('Matcher: "Bash"') || script.includes('MATCHER: "Bash"') ? 'Bash' :
                         script.includes('Matcher: "Edit|Write"') ? 'Edit|Write' : '';

          let settings = {};
          if (existsSync(SETTINGS_PATH)) {
            try { settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')); } catch {}
          }
          if (!settings.hooks) settings.hooks = {};
          if (!settings.hooks[trigger]) settings.hooks[trigger] = [];

          const existing = settings.hooks[trigger].flatMap(e => (e.hooks || []).map(h => h.command));
          if (!existing.some(cmd => cmd.includes(exampleName))) {
            settings.hooks[trigger].push({
              matcher,
              hooks: [{ type: 'command', command: hookPath }],
            });
            mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
            writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
          }

          console.log(c.green + '  ✓ Installed: ' + hookPath + c.reset);
          console.log(c.green + '  ✓ Registered in settings.json (' + trigger + ')' + c.reset);
          console.log(c.dim + '  Restart Claude Code to activate.' + c.reset);
        } else {
          throw new Error('Invalid script');
        }
      } catch {
        // Fallback to cc-safe-setup
        console.log(c.dim + '  Direct download failed, using cc-safe-setup...' + c.reset);
        try { execSync(hook.install, { stdio: 'inherit' }); } catch {}
      }
    } else {
      try { execSync(hook.install, { stdio: 'inherit' }); } catch {}
    }
  } else {
    console.log(c.dim + '  This hook requires manual installation. Follow the instructions above.' + c.reset);
  }
}

else if (command === 'info') {
  const id = args[1];
  if (!id) { console.log(c.red + '  Usage: cc-hook-registry info <id>' + c.reset); process.exit(1); }

  const hook = REGISTRY.find(h => h.id === id);
  if (!hook) {
    console.log(c.red + '  Hook not found: ' + id + c.reset);
    process.exit(1);
  }

  console.log();
  console.log(c.bold + '  ' + hook.name + c.reset);
  console.log('  ' + hook.desc);
  console.log();
  console.log('  ID:       ' + hook.id);
  console.log('  Category: ' + hook.category);
  console.log('  Trigger:  ' + hook.trigger);
  console.log('  Source:   ' + hook.source);
  console.log('  Install:  ' + c.bold + hook.install + c.reset);
  if (hook.issue) console.log('  Issue:    https://github.com/anthropics/claude-code/issues/' + hook.issue.replace('#', ''));
  if (hook.stars) console.log('  Stars:    ' + hook.stars);
  console.log('  Tags:     ' + hook.tags.join(', '));
  console.log();
}

else if (command === 'recommend') {
  console.log();
  console.log(c.bold + '  Recommended hooks for this project' + c.reset);
  console.log();

  const cwd = process.cwd();
  const recommendations = [];

  // Always recommend safety essentials
  recommendations.push({ id: 'destructive-guard', reason: 'Essential — prevents rm -rf disasters', priority: 1 });
  recommendations.push({ id: 'branch-guard', reason: 'Essential — prevents push to main', priority: 1 });
  recommendations.push({ id: 'secret-guard', reason: 'Essential — prevents .env commits', priority: 1 });

  // Detect tech stack
  if (existsSync(join(cwd, 'package.json'))) {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    recommendations.push({ id: 'auto-approve-build', reason: 'Node.js project detected', priority: 2 });
    if (pkg.dependencies?.prisma || pkg.devDependencies?.prisma) {
      recommendations.push({ id: 'block-database-wipe', reason: 'Prisma detected — protect against migrate reset', priority: 1 });
    }
    if (pkg.scripts?.deploy || pkg.scripts?.['vercel-build']) {
      recommendations.push({ id: 'deploy-guard', reason: 'Deploy script detected', priority: 2 });
    }
  }

  if (existsSync(join(cwd, 'requirements.txt')) || existsSync(join(cwd, 'pyproject.toml'))) {
    recommendations.push({ id: 'auto-approve-python', reason: 'Python project detected', priority: 2 });
  }

  if (existsSync(join(cwd, 'Dockerfile')) || existsSync(join(cwd, 'docker-compose.yml'))) {
    recommendations.push({ id: 'auto-approve-docker', reason: 'Docker detected', priority: 2 });
  }

  if (existsSync(join(cwd, '.env')) || existsSync(join(cwd, '.env.local'))) {
    recommendations.push({ id: 'env-source-guard', reason: '.env file present — prevent sourcing', priority: 1 });
  }

  if (existsSync(join(cwd, 'Gemfile'))) {
    recommendations.push({ id: 'block-database-wipe', reason: 'Rails detected — protect against db:drop', priority: 1 });
  }

  if (existsSync(join(cwd, 'artisan'))) {
    recommendations.push({ id: 'block-database-wipe', reason: 'Laravel detected — protect against migrate:fresh', priority: 1 });
  }

  // Always useful
  recommendations.push({ id: 'compound-command-approver', reason: 'Fixes permission matching for cd && commands', priority: 2 });
  recommendations.push({ id: 'loop-detector', reason: 'Prevents infinite command loops', priority: 3 });
  recommendations.push({ id: 'session-handoff', reason: 'Saves state for next session', priority: 3 });
  recommendations.push({ id: 'cost-tracker', reason: 'Track session costs', priority: 3 });

  // Deduplicate and sort by priority
  const seen = new Set();
  const unique = recommendations.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
  unique.sort((a, b) => a.priority - b.priority);

  // Check what's already installed
  let installed = new Set();
  if (existsSync(SETTINGS_PATH)) {
    try {
      const s = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
      for (const entries of Object.values(s.hooks || {})) {
        for (const e of entries) {
          for (const h of (e.hooks || [])) {
            if (h.command) installed.add(h.command.split('/').pop().replace('.sh', ''));
          }
        }
      }
    } catch {}
  }

  for (const rec of unique) {
    const hook = REGISTRY.find(h => h.id === rec.id);
    if (!hook) continue;
    const isInstalled = installed.has(rec.id);
    const icon = isInstalled ? c.green + '✓' + c.reset : c.yellow + '○' + c.reset;
    const status = isInstalled ? c.dim + '(installed)' + c.reset : '';
    console.log('  ' + icon + ' ' + c.bold + rec.id + c.reset + ' ' + status);
    console.log('    ' + c.dim + rec.reason + c.reset);
    if (!isInstalled) {
      console.log('    ' + c.dim + 'Install: npx cc-hook-registry install ' + rec.id + c.reset);
    }
    console.log();
  }

  const notInstalled = unique.filter(r => !installed.has(r.id));
  if (notInstalled.length === 0) {
    console.log(c.green + '  All recommended hooks are installed!' + c.reset);
  } else {
    console.log(c.dim + '  ' + notInstalled.length + ' recommended hook(s) not yet installed.' + c.reset);
  }
  console.log();
}

else if (command === 'init') {
  console.log();
  console.log(c.bold + '  cc-hook-registry init' + c.reset);
  console.log(c.dim + '  Quick setup — installing essential + project-specific hooks' + c.reset);
  console.log();

  const cwd = process.cwd();
  const toInstall = [];

  // Essential hooks (always install)
  toInstall.push('destructive-guard', 'branch-guard', 'secret-guard');

  // Detect project type
  if (existsSync(join(cwd, 'package.json'))) {
    console.log('  ' + c.blue + '⬡' + c.reset + ' Node.js detected');
    toInstall.push('auto-approve-build');
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
      if (pkg.dependencies?.prisma || pkg.devDependencies?.prisma) {
        console.log('  ' + c.blue + '⬡' + c.reset + ' Prisma detected');
        toInstall.push('block-database-wipe');
      }
    } catch {}
  }
  if (existsSync(join(cwd, 'requirements.txt')) || existsSync(join(cwd, 'pyproject.toml'))) {
    console.log('  ' + c.blue + '⬡' + c.reset + ' Python detected');
    toInstall.push('auto-approve-python');
  }
  if (existsSync(join(cwd, 'Dockerfile'))) {
    console.log('  ' + c.blue + '⬡' + c.reset + ' Docker detected');
    toInstall.push('auto-approve-docker');
  }
  if (existsSync(join(cwd, '.env'))) {
    console.log('  ' + c.blue + '⬡' + c.reset + ' .env file detected');
    toInstall.push('env-source-guard');
  }
  if (existsSync(join(cwd, 'Gemfile')) || existsSync(join(cwd, 'artisan'))) {
    console.log('  ' + c.blue + '⬡' + c.reset + ' Rails/Laravel detected');
    toInstall.push('block-database-wipe');
  }

  // Always useful
  toInstall.push('compound-command-approver', 'loop-detector', 'session-handoff');

  // Deduplicate
  const unique = [...new Set(toInstall)];

  // Check what's already installed
  const installed = new Set();
  if (existsSync(HOOKS_DIR)) {
    const { readdirSync } = await import('fs');
    for (const f of readdirSync(HOOKS_DIR)) {
      installed.add(f.replace('.sh', ''));
    }
  }

  const toActuallyInstall = unique.filter(id => !installed.has(id));

  console.log();
  if (toActuallyInstall.length === 0) {
    console.log(c.green + '  All recommended hooks already installed!' + c.reset);
    console.log();
    process.exit(0);
  }

  console.log(c.bold + '  Installing ' + toActuallyInstall.length + ' hooks:' + c.reset);

  for (const id of toActuallyInstall) {
    const hook = REGISTRY.find(h => h.id === id);
    if (!hook) continue;

    // Try direct download
    const rawUrl = `https://raw.githubusercontent.com/yurukusa/cc-safe-setup/main/examples/${id}.sh`;
    const hookPath = join(HOOKS_DIR, id + '.sh');

    try {
      mkdirSync(HOOKS_DIR, { recursive: true });
      const script = execSync(`curl -sL "${rawUrl}"`, { encoding: 'utf-8', timeout: 5000 });

      if (script.startsWith('#!/bin/bash')) {
        writeFileSync(hookPath, script);
        chmodSync(hookPath, 0o755);

        // Register in settings
        const trigger = script.includes('PreToolUse') ? 'PreToolUse' :
                       script.includes('PostToolUse') ? 'PostToolUse' :
                       script.includes('Stop') ? 'Stop' :
                       script.includes('SessionStart') ? 'SessionStart' : 'PreToolUse';
        const matcher = script.includes('MATCHER: "Bash"') ? 'Bash' :
                       script.includes('MATCHER: "Edit|Write"') ? 'Edit|Write' : '';

        let settings = {};
        if (existsSync(SETTINGS_PATH)) {
          try { settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')); } catch {}
        }
        if (!settings.hooks) settings.hooks = {};
        if (!settings.hooks[trigger]) settings.hooks[trigger] = [];

        const existing = settings.hooks[trigger].flatMap(e => (e.hooks || []).map(h => h.command));
        if (!existing.some(cmd => cmd.includes(id))) {
          settings.hooks[trigger].push({ matcher, hooks: [{ type: 'command', command: hookPath }] });
          mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
          writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
        }

        console.log('  ' + c.green + '✓' + c.reset + ' ' + id);
      }
    } catch {
      console.log('  ' + c.yellow + '✗' + c.reset + ' ' + id + c.dim + ' (download failed)' + c.reset);
    }
  }

  console.log();
  console.log(c.green + '  Done! Restart Claude Code to activate.' + c.reset);
  console.log(c.dim + '  Run: npx cc-hook-registry list' + c.reset);
  console.log();
}

else if (command === 'list') {
  console.log();
  console.log(c.bold + '  Installed Hooks' + c.reset);
  console.log();

  if (!existsSync(HOOKS_DIR)) {
    console.log(c.dim + '  No hooks directory.' + c.reset);
    process.exit(0);
  }

  const { readdirSync, statSync } = await import('fs');
  const files = readdirSync(HOOKS_DIR).filter(f => f.endsWith('.sh')).sort();

  // Count by trigger
  let byTrigger = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      const s = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
      for (const [trigger, entries] of Object.entries(s.hooks || {})) {
        for (const e of entries) {
          for (const h of (e.hooks || [])) {
            const name = (h.command || '').split('/').pop();
            if (name) byTrigger[name] = trigger;
          }
        }
      }
    } catch {}
  }

  for (const file of files) {
    const path = join(HOOKS_DIR, file);
    const name = file.replace('.sh', '');
    const size = statSync(path).size;
    const mtime = statSync(path).mtime;
    const age = Math.floor((Date.now() - mtime.getTime()) / 86400000);
    const inRegistry = REGISTRY.some(h => h.id === name);
    const trigger = byTrigger[file] || '?';

    const icon = inRegistry ? c.green + '●' + c.reset : c.dim + '○' + c.reset;
    const ageStr = age === 0 ? 'today' : age + 'd ago';
    const triggerStr = c.dim + trigger.padEnd(16) + c.reset;

    console.log('  ' + icon + ' ' + file.padEnd(30) + triggerStr + (size/1024).toFixed(1) + 'KB  ' + c.dim + ageStr + c.reset);
  }

  console.log();
  const inReg = files.filter(f => REGISTRY.some(h => h.id === f.replace('.sh', ''))).length;
  console.log('  ' + files.length + ' hooks installed (' + c.green + inReg + ' in registry' + c.reset + ', ' + c.dim + (files.length - inReg) + ' custom' + c.reset + ')');
  console.log();
}

else if (command === 'update') {
  const targetId = args[1]; // Optional: update specific hook or all
  console.log();
  console.log(c.bold + '  Updating hooks...' + c.reset);
  console.log();

  if (!existsSync(HOOKS_DIR)) {
    console.log(c.dim + '  No hooks installed.' + c.reset);
    process.exit(0);
  }

  const { readdirSync } = await import('fs');
  const installed = readdirSync(HOOKS_DIR).filter(f => f.endsWith('.sh'));
  let updated = 0;
  let skipped = 0;

  for (const file of installed) {
    const name = file.replace('.sh', '');
    if (targetId && name !== targetId) continue;

    const hook = REGISTRY.find(h => h.id === name);
    if (!hook || !hook.install.includes('--install-example')) {
      skipped++;
      continue;
    }

    const rawUrl = `https://raw.githubusercontent.com/yurukusa/cc-safe-setup/main/examples/${name}.sh`;
    try {
      const remote = execSync(`curl -sL "${rawUrl}" 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 });
      const local = readFileSync(join(HOOKS_DIR, file), 'utf-8');

      if (remote.trim() !== local.trim() && remote.startsWith('#!/bin/bash')) {
        writeFileSync(join(HOOKS_DIR, file), remote);
        chmodSync(join(HOOKS_DIR, file), 0o755);
        console.log('  ' + c.green + '↑' + c.reset + ' Updated: ' + name);
        updated++;
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  if (updated === 0) {
    console.log(c.green + '  All hooks are up to date.' + c.reset);
  } else {
    console.log();
    console.log(c.green + '  Updated ' + updated + ' hook(s).' + c.reset + ' Restart Claude Code.');
  }
  console.log();
}

else if (command === 'uninstall') {
  const id = args[1];
  if (!id) { console.log(c.red + '  Usage: cc-hook-registry uninstall <id>' + c.reset); process.exit(1); }

  const hookPath = join(HOOKS_DIR, id + '.sh');
  console.log();

  if (!existsSync(hookPath)) {
    console.log(c.red + '  Hook not installed: ' + id + c.reset);
    process.exit(1);
  }

  // Remove script
  const { unlinkSync } = await import('fs');
  unlinkSync(hookPath);
  console.log(c.green + '  ✓ Removed: ' + hookPath + c.reset);

  // Remove from settings.json
  if (existsSync(SETTINGS_PATH)) {
    try {
      const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
      for (const trigger of Object.keys(settings.hooks || {})) {
        settings.hooks[trigger] = settings.hooks[trigger].filter(entry =>
          !(entry.hooks || []).some(h => (h.command || '').includes(id))
        );
        if (settings.hooks[trigger].length === 0) delete settings.hooks[trigger];
      }
      writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
      console.log(c.green + '  ✓ Removed from settings.json' + c.reset);
    } catch {}
  }

  console.log(c.dim + '  Restart Claude Code to take effect.' + c.reset);
  console.log();
}

else if (command === 'outdated') {
  console.log();
  console.log(c.bold + '  Checking installed hooks for updates...' + c.reset);
  console.log();

  if (!existsSync(HOOKS_DIR)) {
    console.log(c.dim + '  No hooks installed.' + c.reset);
    process.exit(0);
  }

  const { readdirSync } = await import('fs');
  const installed = readdirSync(HOOKS_DIR).filter(f => f.endsWith('.sh'));
  let outdated = 0;
  let upToDate = 0;
  let unknown = 0;

  for (const file of installed) {
    const name = file.replace('.sh', '');
    const hook = REGISTRY.find(h => h.id === name);
    const localContent = readFileSync(join(HOOKS_DIR, file), 'utf-8');
    const localLines = localContent.split('\n').length;

    if (!hook) {
      // Custom hook, not in registry
      console.log('  ' + c.dim + '?' + c.reset + ' ' + file + c.dim + ' (custom, not in registry)' + c.reset);
      unknown++;
      continue;
    }

    // Check against GitHub for cc-safe-setup hooks
    if (hook.source === 'cc-safe-setup' && hook.install.includes('--install-example')) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/yurukusa/cc-safe-setup/main/examples/${name}.sh`;
        const remote = execSync(`curl -sL "${rawUrl}" 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 });
        const remoteLines = remote.split('\n').length;

        if (remote.trim() === localContent.trim()) {
          console.log('  ' + c.green + '✓' + c.reset + ' ' + file + c.dim + ' (up to date)' + c.reset);
          upToDate++;
        } else {
          const diff = remoteLines - localLines;
          console.log('  ' + c.yellow + '↑' + c.reset + ' ' + file + c.yellow + ' (update available: ' + (diff > 0 ? '+' : '') + diff + ' lines)' + c.reset);
          console.log('    ' + c.dim + 'Update: npx cc-hook-registry install ' + name + c.reset);
          outdated++;
        }
      } catch {
        console.log('  ' + c.dim + '?' + c.reset + ' ' + file + c.dim + ' (could not check)' + c.reset);
        unknown++;
      }
    } else {
      console.log('  ' + c.dim + '—' + c.reset + ' ' + file + c.dim + ' (external: ' + hook.source + ')' + c.reset);
      unknown++;
    }
  }

  console.log();
  console.log('  ' + c.green + upToDate + ' up to date' + c.reset + '  ' + c.yellow + outdated + ' outdated' + c.reset + '  ' + c.dim + unknown + ' unchecked' + c.reset);
  console.log();
}

else if (command === 'stats') {
  const categories = {};
  const sources = {};
  for (const h of REGISTRY) {
    categories[h.category] = (categories[h.category] || 0) + 1;
    sources[h.source] = (sources[h.source] || 0) + 1;
  }

  console.log();
  console.log(c.bold + '  Registry Statistics' + c.reset);
  console.log();
  console.log('  Total hooks: ' + c.bold + REGISTRY.length + c.reset);
  console.log();
  console.log('  By category:');
  for (const [cat, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
    console.log('    ' + cat.padEnd(15) + count);
  }
  console.log();
  console.log('  By source:');
  for (const [src, count] of Object.entries(sources).sort((a, b) => b[1] - a[1])) {
    console.log('    ' + src.padEnd(40) + count);
  }
  console.log();
}

else {
  console.log(c.red + '  Unknown command: ' + command + c.reset);
  console.log(c.dim + '  Run cc-hook-registry --help for usage.' + c.reset);
  process.exit(1);
}
