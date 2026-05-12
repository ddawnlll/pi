#!/bin/bash
# Run Pi tests with OpenCode-Go provider
# Usage: OPENCODE_API_KEY=your_key ./scripts/run-tests-opencode.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Pi Tests with OpenCode-Go Provider ===${NC}\n"

# Check if API key is set
if [ -z "$OPENCODE_API_KEY" ]; then
    echo -e "${RED}Error: OPENCODE_API_KEY environment variable not set${NC}"
    echo ""
    echo "Usage:"
    echo "  OPENCODE_API_KEY=your_key $0"
    echo ""
    echo "Get your API key from: https://opencode.ai"
    exit 1
fi

echo -e "${GREEN}✓${NC} API key found"

# Navigate to coding-agent package
cd packages/coding-agent

# Verify model is available
echo -e "\n${YELLOW}Checking if deepseek-v4-flash is available...${NC}"
if node -e "const {getModel} = require('@earendil-works/pi-ai'); const m = getModel('opencode-go', 'deepseek-v4-flash'); if (!m) process.exit(1);" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Model deepseek-v4-flash is available"
else
    echo -e "${RED}✗${NC} Model not found. Building packages..."
    cd ../..
    npm run build
    cd packages/coding-agent
fi

# Run real agent execution tests
echo -e "\n${YELLOW}=== Running Real Agent Execution Tests ===${NC}"
echo "This will make real LLM API calls (estimated cost: $0.01-0.05)"
echo ""

if npm test -- real-agent-execution.test.ts; then
    echo -e "\n${GREEN}✓ Real agent execution tests PASSED${NC}"
else
    echo -e "\n${RED}✗ Real agent execution tests FAILED${NC}"
    exit 1
fi

# Run E2E smoke tests
echo -e "\n${YELLOW}=== Running E2E Smoke Tests ===${NC}"
echo "This will run complete autonomous plan execution (estimated cost: $0.05-0.10)"
echo ""

if npm test -- e2e-smoke.test.ts; then
    echo -e "\n${GREEN}✓ E2E smoke tests PASSED${NC}"
else
    echo -e "\n${RED}✗ E2E smoke tests FAILED${NC}"
    exit 1
fi

# Summary
echo -e "\n${GREEN}=== All Tests PASSED! ===${NC}"
echo ""
echo "Summary:"
echo "  ✓ Real agent execution tests (6 tests)"
echo "  ✓ E2E smoke tests (2 tests)"
echo ""
echo "Pi's autonomous execution system is validated and ready for production!"
