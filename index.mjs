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
    try {
      execSync(hook.install, { stdio: 'inherit' });
    } catch (e) {
      console.log(c.yellow + '  Run the command manually: ' + hook.install + c.reset);
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
