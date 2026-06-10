import { planRun } from './packages/coding-agent/src/cli/plan-commands.js';

const exitCode = await planRun(
  process.argv[2] || 'docs/P44_MASTERPLAN_v411_PARSEABLE_WAVES/waves/W1_FOUNDATION_MASTER_PLAN_v4_1_1.md',
  {
    cwd: process.cwd(),
    verbose: true,
    json: false,
    workers: 3,
  },
);
process.exit(exitCode);
