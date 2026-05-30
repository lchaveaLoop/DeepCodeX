import type { AgentRunState, ToolExecutionInfo, VerificationResult } from '@fagent/agent';

function countToolResults(run: AgentRunState): {
  total: number;
  succeeded: number;
  failed: number;
} {
  const toolResults = run.steps.filter((step) => step.kind === 'tool_result');
  const succeeded = toolResults.filter((step) => step.data?.ok === true).length;
  const failed = toolResults.filter((step) => step.data?.ok === false).length;
  return { total: toolResults.length, succeeded, failed };
}

function latestResultFor(
  command: string,
  results: VerificationResult[],
): VerificationResult | undefined {
  return [...results].reverse().find((result) => result.command === command);
}

function deliveryStatus(run: AgentRunState): string {
  const verification = run.verification;
  if (!verification || verification.commands.length === 0) return 'no verification configured';

  const requiredCommands = verification.commands.filter((command) => command.required);
  if (requiredCommands.length === 0) return 'ready';

  const requiredResults = requiredCommands.map((command) =>
    latestResultFor(command.command, verification.results),
  );

  if (requiredResults.some((result) => result?.status === 'failed')) {
    return 'verification failed';
  }

  if (!run.workspaceChanges?.changed) {
    return 'ready (no workspace changes)';
  }

  if (requiredResults.some((result) => result?.status !== 'passed')) {
    return 'needs verification';
  }

  return 'ready';
}

function workspaceChangeText(run: AgentRunState): string {
  const count = run.workspaceChanges?.changes.length ?? 0;
  return count > 0 ? String(count) : 'none';
}

export function renderWelcome(options: {
  provider: string;
  model: string;
  workspace: string;
}): string {
  return [
    'DeepCodeX Agent',
    `Provider: ${options.provider}  Model: ${options.model}`,
    `Workspace: ${options.workspace}`,
    'Mode: compact output. Use /verbose for full reasoning and tool output.',
    'Type /help for commands.',
  ].join('\n');
}

export function renderHelp(): string {
  return [
    'Commands:',
    '  /help             Show commands',
    '  /tools            List available tools',
    '  /status           Show last run cockpit',
    '  /plan             Show current plan',
    '  /plan clear       Clear current plan',
    '  /verbose          Show reasoning and fuller tool output',
    '  /compact          Return to compact output',
    '  /save <path>      Save session to JSON',
    '  /load <path>      Load saved session',
    '  /reset            Start a fresh session',
    '  /exit             Quit',
  ].join('\n');
}

export function renderRunCockpit(run: AgentRunState | null): string {
  if (!run) return 'Cockpit: no run has completed yet.';

  const delivery = deliveryStatus(run);
  const tools = countToolResults(run);
  const verification = run.verification;
  const required = verification?.commands.filter((command) => command.required) ?? [];
  const passedRequired = required.filter((command) => {
    const result = latestResultFor(command.command, verification?.results ?? []);
    return result?.status === 'passed';
  }).length;
  const failed = verification?.results.filter((result) => result.status === 'failed').length ?? 0;
  const activeStep = [...run.steps]
    .reverse()
    .find((step) => step.kind === 'tool_call' || step.kind === 'verification_required');

  return [
    'Cockpit',
    `  Run: ${run.status}  Rounds: ${run.totalRounds}  Delivery: ${delivery}`,
    `  Tools: ${tools.succeeded}/${tools.total} succeeded${tools.failed ? `, ${tools.failed} failed` : ''}`,
    `  Workspace: ${workspaceChangeText(run)} change(s)`,
    required.length > 0
      ? `  Required verification: ${passedRequired}/${required.length} passed${failed ? `, ${failed} failed` : ''}`
      : '  Required verification: none',
    activeStep
      ? `  Last activity: ${activeStep.kind}${activeStep.toolName ? ` ${activeStep.toolName}` : ''}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function renderRunSummary(run: AgentRunState | null): string {
  if (!run) return 'No run has completed yet.';

  const tools = countToolResults(run);
  const lines = [
    `Run: ${run.status}`,
    `Delivery: ${deliveryStatus(run)}`,
    `Workspace changes: ${workspaceChangeText(run)}`,
    `Rounds: ${run.totalRounds}`,
    `Tools: ${tools.total} total, ${tools.succeeded} succeeded, ${tools.failed} failed`,
  ];

  const verification = run.verification;
  if (verification && verification.commands.length > 0) {
    const passed = verification.results.filter((result) => result.status === 'passed').length;
    const failed = verification.results.filter((result) => result.status === 'failed').length;
    const failedText = failed > 0 ? `, ${failed} failed` : '';
    lines.push(`Verification: ${passed}/${verification.commands.length} passed${failedText}`);

    for (const command of verification.commands) {
      const result = latestResultFor(command.command, verification.results);
      const status = result?.status ?? 'pending';
      lines.push(`  [${status}] ${command.command}`);
    }
  } else {
    lines.push('Verification: no commands inferred');
  }

  return lines.join('\n');
}

export function renderToolCallLine(name: string, args: Record<string, unknown>): string {
  return `Tool: ${name}${formatPrimaryArgs(args)}`;
}

export function renderToolResultPreview(result: string, options: { verbose: boolean }): string {
  const lines = result.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return 'Result: (no output)';

  if (options.verbose) {
    return lines.slice(0, 12).join('\n') + (lines.length > 12 ? '\n... output truncated' : '');
  }

  const first = lines[0];
  const suffix = lines.length > 1 ? ` (+${lines.length - 1} lines)` : '';
  return `Result: ${truncate(first, 120)}${suffix}`;
}

export function renderConfirmationCard(options: {
  name: string;
  args: Record<string, unknown>;
  execution?: ToolExecutionInfo;
}): string {
  const lines = [
    'Action requires approval',
    `  Tool: ${options.name}`,
    `  Target: ${formatPrimaryArgs(options.args).trim() || '(none)'}`,
  ];

  if (options.execution) {
    lines.push(`  Risk: ${options.execution.risk.toUpperCase()}`);
    if (options.execution.reasons.length > 0) {
      lines.push(`  Why: ${options.execution.reasons.slice(0, 3).join('; ')}`);
    }
  }

  lines.push(`  Args: ${truncate(JSON.stringify(options.args), 220)}`);
  lines.push('Approve? [y] run  [n] reject');
  return lines.join('\n');
}

function formatPrimaryArgs(args: Record<string, unknown>): string {
  if (typeof args.command === 'string') return ` ${args.command}`;
  if (typeof args.path === 'string') {
    const size =
      typeof args.content === 'string'
        ? ` (${Buffer.byteLength(args.content, 'utf-8')} bytes)`
        : '';
    return ` ${args.path}${size}`;
  }

  const preview = JSON.stringify(args);
  return preview && preview !== '{}' ? ` ${truncate(preview, 80)}` : '';
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
