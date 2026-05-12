# Running Pi Tests with OpenCode-Go Provider

This guide shows how to run Pi's autonomous execution tests using the OpenCode-Go provider with DeepSeek models.

## Prerequisites

1. **OpenCode API Key**: Get your API key from https://opencode.ai
2. **Pi Built**: Ensure packages are built (`npm run build` in packages/coding-agent)

## Supported Models

Pi supports these OpenCode-Go models:
- `deepseek-v4-flash` (recommended for testing - fast and cheap)
- `deepseek-v4`
- `qwen-2.5-coder-32b`
- `qwen-qwq-32b`
- And more...

## Setup

### 1. Set API Key as Environment Variable

```bash
# Set your OpenCode API key
export OPENCODE_API_KEY=your_api_key_here
```

**IMPORTANT**: Never commit API keys to code or share them in chat!

### 2. Verify Model Availability

```bash
# Check if deepseek-v4-flash is available
cd packages/coding-agent
node -e "const {getModel} = require('@earendil-works/pi-ai'); console.log(getModel('opencode-go', 'deepseek-v4-flash'));"
```

## Running Tests

### Option 1: Run Individual Test Suites

```bash
cd packages/coding-agent

# Run real agent execution tests (6 tests)
npm test -- real-agent-execution.test.ts

# Run E2E smoke tests (2 tests)
npm test -- e2e-smoke.test.ts
```

### Option 2: Run All Tests Together

```bash
cd packages/coding-agent
npm test -- real-agent-execution.test.ts e2e-smoke.test.ts
```

### Option 3: Use the Helper Script

```bash
# From repo root
OPENCODE_API_KEY=your_key_here bash scripts/run-tests-opencode.sh
```

## Test Details

### Real Agent Execution Tests (60s timeout each)
1. **Create simple text file** - Tests write_to_file tool
2. **Read and modify file** - Tests read_file + write_to_file
3. **Execute command** - Tests execute_command tool
4. **Handle blocked verdict** - Tests error handling
5. **Generate logs** - Validates logging infrastructure
6. **Respect file permissions** - Tests canEdit/cannotEdit

### E2E Smoke Tests (3-5 min timeout each)
1. **Complete plan execution** - 3 workspaces with dependencies
2. **Dependency ordering** - Sequential execution validation

## Expected Output

```
✓ test/real-agent-execution.test.ts (6 passed)
✓ test/e2e-smoke.test.ts (2 passed)

Test Files  2 passed (2)
     Tests  8 passed (8)
```

## Troubleshooting

### Tests are Skipped
- Check that `SKIP_REAL_AGENT_TESTS` and `SKIP_E2E_SMOKE_TEST` are NOT set to "1"
- Verify `OPENCODE_API_KEY` is set: `echo $OPENCODE_API_KEY`

### Model Not Found
- Ensure packages are built: `cd packages/coding-agent && npm run build`
- Check model name spelling: `deepseek-v4-flash` (not `deepseek-v4flash`)

### API Key Errors
- Verify your API key is valid at https://opencode.ai
- Check for typos in the environment variable name

### Timeout Errors
- Tests have generous timeouts (60s-300s)
- If tests timeout, check your network connection
- DeepSeek-v4-flash should be fast enough for all tests

## Cost Estimation

Using `deepseek-v4-flash`:
- Real agent tests: ~$0.01-0.05 total
- E2E smoke tests: ~$0.05-0.10 total
- **Total cost**: Less than $0.15 for all tests

## Security Best Practices

1. **Never commit API keys** to git
2. **Use environment variables** for API keys
3. **Revoke keys** if accidentally exposed
4. **Use separate keys** for testing vs production

## Next Steps

After tests pass:
1. Review test logs in `/tmp/real-agent-test-*/`
2. Check execution logs for agent activity
3. Deploy to staging with confidence
4. Run tests again in staging environment
