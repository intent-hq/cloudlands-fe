#!/bin/bash
# Test CDP MCP Bridge

# Click the "Let's go" onboarding button
curl -s -X POST http://localhost:9224/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"cdp.run_script","arguments":{"script":"var btns=document.querySelectorAll(\"button\"); for(var i=0;i<btns.length;i++){if(/Let.s go/.test(btns[i].innerText)){btns[i].click();break;}} \"clicked\""}}}'

echo ""
echo "Waiting for workspace to load..."
sleep 5

# Get the current DOM to see state
curl -s -X POST http://localhost:9224/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"cdp.get_dom","arguments":{}}}' | head -c 2000

echo ""
