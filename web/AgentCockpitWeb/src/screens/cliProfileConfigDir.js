/* Copy for the account-profile Config directory field. Each harness maps
   `configDir` to its own CLI auth-home variable at runtime. */
export function cliConfigDirField(harness){
  if (harness === 'codex') return { hint: 'Maps to CODEX_HOME at runtime.', placeholder: '/Users/server/.codex-account' };
  if (harness === 'grok-build') return { hint: 'Maps to GROK_HOME at runtime.', placeholder: '/Users/server/.grok-account' };
  return { hint: 'Maps to CLAUDE_CONFIG_DIR at runtime.', placeholder: '/Users/server/.claude-account' };
}
