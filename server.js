const express = require('express');
const app = express();

app.use(express.json());

// Built-in CORS headers (no 'cors' package required)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const PORT = process.env.PORT || 8080;

// 1. Glama Ownership Verification Route
app.get('/.well-known/glama.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({
    "$schema": "https://glama.ai/mcp/schemas/connector.json",
    "claim": "glama_claim_PQLFXmVfkhqAn4n9dNbVmsunPEBgKAEn"
  }));
});

// 2. MCP JSON-RPC Handler (Supports '/', '/mcp', and '/sse')
const handleMcp = async (req, res) => {
  const body = req.body || {};
  const { method, id, params } = body;

  if (method === 'initialize') {
    return res.status(200).json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "AgentGate M2M Web Extractor",
          version: "3.0.0"
        }
      }
    });
  }

  if (method === 'notifications/initialized') {
    return res.status(202).end();
  }

  if (method === 'ping') {
    return res.status(200).json({ jsonrpc: "2.0", id, result: {} });
  }

  if (method === 'tools/list') {
    return res.status(200).json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "register_agent_wallet",
            description: "Register agent wallet with AgentGate",
            inputSchema: {
              type: "object",
              properties: {
                wallet: { type: "string", description: "Agent wallet address" }
              },
              required: ["wallet"]
            }
          },
          {
            name: "extract_url_content",
            description: "Extract webpage content via AgentGate M2M gateway",
            inputSchema: {
              type: "object",
              properties: {
                url: { type: "string", description: "Target URL to extract" }
              },
              required: ["url"]
            }
          }
        ]
      }
    });
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};

    if (toolName === 'register_agent_wallet') {
      return res.status(200).json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Wallet ${args.wallet || 'agent'} registered.` }]
        }
      });
    }

    if (toolName === 'extract_url_content') {
      try {
        const response = await fetch(args.url);
        const text = await response.text();
        return res.status(200).json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: text.substring(0, 5000) }]
          }
        });
      } catch (err) {
        return res.status(200).json({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: `Extraction error: ${err.message}` }]
          }
        });
      }
    }
  }

  return res.status(200).json({
    jsonrpc: "2.0",
    id: id !== undefined ? id : null,
    result: {}
  });
};

app.post('/', handleMcp);
app.post('/mcp', handleMcp);
app.post('/sse', handleMcp);

// 3. Existing OpenAPI & REST Endpoints
const openApiSpec = {
  openapi: "3.1.0",
  info: { title: "AgentGate M2M Web Extractor", version: "3.0.0" },
  servers: [{ url: "https://agentgate-production-15b2.up.railway.app" }],
  paths: {
    "/register": { post: { summary: "Register agent wallet" } },
    "/gateway": { post: { summary: "Extract URL content" } }
  }
};

app.get('/', (req, res) => res.status(200).json(openApiSpec));
app.get('/openapi.json', (req, res) => res.status(200).json(openApiSpec));

app.post('/register', (req, res) => {
  const { wallet } = req.body || {};
  res.status(200).json({ status: "registered", wallet: wallet || "anonymous-agent" });
});

app.post('/gateway', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "Missing 'url' parameter" });
  try {
    const response = await fetch(url);
    const text = await response.text();
    res.status(200).json({ status: "success", url, content: text.substring(0, 10000) });
  } catch (err) {
    res.status(500).json({ error: "Failed to extract URL", details: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
