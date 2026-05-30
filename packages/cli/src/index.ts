#!/usr/bin/env node
/** DeepSeek Agent — interactive CLI (TypeScript). */

import * as readline from 'node:readline';
import {
  config,
  Agent,
  createRegistry,
  saveSession,
  loadSession,
  type ToolCall,
} from '@fagent/agent';
import { renderPlan, renderPlanProgress } from './plan-render.js';
import {
  renderConfirmationCard,
  renderHelp,
  renderRunCockpit,
  renderRunSummary,
  renderToolCallLine,
  renderToolResultPreview,
  renderWelcome,
} from './run-render.js';

// ═══════════════════════════════════════════════════
// ANSI styling
// ═══════════════════════════════════════════════════
const ansi = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

function style(text: string, ...codes: string[]): string {
  return codes.join('') + text + ansi.reset;
}

// ── Separator lines ──
const SEP = style('─'.repeat(40), ansi.dim);

// ═══════════════════════════════════════════════════
// Shared readline — created once, reused forever
// ═══════════════════════════════════════════════════
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// ═══════════════════════════════════════════════════
// Output state machine — eliminates visual jank
// ═══════════════════════════════════════════════════
type Phase = 'idle' | 'reasoning' | 'content' | 'tool_calls';

let phase: Phase = 'idle';
let pendingNewline = false; // reasoning writes need trailing \n before content
let lastRenderedPlanId: string | null = null;
let outputMode: 'compact' | 'verbose' = 'compact';
let showedThinking = false;

function enterPhase(newPhase: Phase) {
  if (phase === newPhase) return;

  // Close reasoning cleanly
  if (phase === 'reasoning' && newPhase !== 'reasoning') {
    if (pendingNewline) {
      process.stdout.write(ansi.reset + '\n');
      pendingNewline = false;
    }
  }

  if (phase === 'content' && newPhase === 'tool_calls') {
    process.stdout.write('\n');
  }

  switch (newPhase) {
    case 'reasoning':
      process.stdout.write('\n' + style('💭 ', ansi.dim));
      pendingNewline = true;
      break;
  }

  phase = newPhase;
}

// ═══════════════════════════════════════════════════
// Build agent
// ═══════════════════════════════════════════════════
function buildAgent() {
  return new Agent({
    registry: createRegistry(),
    callbacks: {
      onReasoning(text) {
        if (outputMode === 'compact') {
          if (!showedThinking) {
            console.log(style('Thinking...', ansi.gray));
            showedThinking = true;
          }
          return;
        }
        enterPhase('reasoning');
        process.stdout.write(text);
      },
      onToken(text) {
        enterPhase('content');
        process.stdout.write(text);
      },
      onToolCall(tc: ToolCall) {
        enterPhase('tool_calls');
        console.log(`\n${style(renderToolCallLine(tc.name, tc.arguments), ansi.cyan)}`);
      },
      onToolResult(_tc, result) {
        const preview = renderToolResultPreview(result, { verbose: outputMode === 'verbose' });
        const lines = preview.split('\n');
        for (const line of lines) console.log(`  ${style(line, ansi.gray)}`);
      },
      async onConfirm(name, args, execution) {
        console.log(SEP);
        console.log(style(renderConfirmationCard({ name, args, execution }), ansi.yellow));
        const answer = await ask(`  ${style('Choice: ', ansi.yellow)}`);
        console.log(SEP);
        return answer.trim().toLowerCase() === 'y';
      },
      onPlanUpdate(plan) {
        if (phase === 'reasoning' && pendingNewline) {
          process.stdout.write(ansi.reset + '\n');
          pendingNewline = false;
        }
        if (lastRenderedPlanId !== plan.id) {
          lastRenderedPlanId = plan.id;
          console.log('\n' + style(renderPlan(plan), ansi.gray));
        } else {
          console.log(style(renderPlanProgress(plan), ansi.gray));
        }
      },
    },
  });
}

// ═══════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════
async function main() {
  const providerConfig = config.getProviderConfig();
  console.log();
  console.log(
    style(
      renderWelcome({
        provider: config.DEFAULT_PROVIDER.toUpperCase(),
        model: providerConfig.model,
        workspace: process.cwd(),
      }),
      ansi.magenta,
    ),
  );
  console.log();

  let agent = buildAgent();

  for (;;) {
    const input = (await ask(style('You: ', ansi.green))).trim();
    if (!input) continue;

    if (input.startsWith('/')) {
      const [cmd, ...rest] = input.split(/\s+/);
      const arg = rest.join(' ');

      switch (cmd) {
        case '/exit':
        case '/quit':
        case '/q':
          console.log(style('Goodbye!', ansi.dim));
          rl.close();
          return;

        case '/help':
          console.log(renderHelp());
          continue;

        case '/tools': {
          const reg = createRegistry();
          for (const name of reg.listNames().sort()) {
            const t = reg.get(name);
            const icon = t?.requiresConfirm ? ` ${style('⚠', ansi.yellow)}` : '';
            console.log(`  ${style(name, ansi.cyan)}${icon}  ${t?.description ?? ''}`);
          }
          console.log();
          continue;
        }

        case '/plan':
          if (arg === 'clear') {
            agent.clearPlan();
            lastRenderedPlanId = null;
            console.log(style('Plan cleared.', ansi.dim));
          } else {
            console.log(renderPlan(agent.currentPlan));
          }
          continue;

        case '/status':
          console.log(renderRunCockpit(agent.currentRun));
          console.log();
          console.log(renderRunSummary(agent.currentRun));
          continue;

        case '/verbose':
        case '/trace':
          outputMode = 'verbose';
          console.log(style('Output mode: verbose.', ansi.dim));
          continue;

        case '/compact':
          outputMode = 'compact';
          console.log(style('Output mode: compact.', ansi.dim));
          continue;

        case '/save':
          if (!arg) {
            console.log(style('Usage: /save <filepath>', ansi.red));
            continue;
          }
          try {
            await saveSession(agent.messageHistory, arg);
            console.log(`  Saved → ${style(arg, ansi.yellow)}`);
          } catch (e: unknown) {
            const err = e as Error;
            console.log(style(err?.message || String(e), ansi.red));
          }
          continue;

        case '/load':
          if (!arg) {
            console.log(style('Usage: /load <filepath>', ansi.red));
            continue;
          }
          try {
            const msgs = await loadSession(arg);
            agent = buildAgent();
            agent.loadMessages(msgs);
            console.log(`  Loaded ${msgs.length} msgs ← ${style(arg, ansi.yellow)}`);
          } catch (e: unknown) {
            const err = e as Error;
            console.log(style(err?.message || String(e), ansi.red));
          }
          continue;

        case '/reset':
          agent = buildAgent();
          phase = 'idle';
          lastRenderedPlanId = null;
          console.log(style('Session reset.', ansi.dim));
          continue;

        default:
          console.log(style(`Unknown: ${cmd}`, ansi.red));
          continue;
      }
    }

    phase = 'idle';
    pendingNewline = false;
    showedThinking = false;
    console.log();
    try {
      await agent.run(input);
      console.log('\n' + style(renderRunCockpit(agent.currentRun), ansi.gray));
    } catch (e: unknown) {
      const err = e as Error;
      console.log(style(`\nError: ${err?.message || e}`, ansi.red));
    }
    console.log('\n' + style('·'.repeat(40), ansi.dim));
  }
}

main().catch((e) => {
  console.error(e);
  rl.close();
  process.exit(1);
});
