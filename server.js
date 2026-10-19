const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// 1. Glama Ownership Verification Route
app.get('/.well-known/glama.json', (req, res) => {
  res.status(200).json({
    "$schema": "https://glama.ai/mcp/schemas/connector.json",
    "claim": "glama_claim_PQLFXmVfkhqAn4n9dNbVmsunPEBgKAEn"
  });
});

// 2. OpenAPI Specification (GET Root & /openapi.json)
const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "AgentGate M2M Web Extractor",
    version: "3.0.0"
  },
  servers: [
    { url: "https://agentgate-production-15b2.up.railway.app" }
  ],
  paths: {
    "/register": {
      post: { summary: "Register agent wallet" }
    },
    "/gateway": {
      post: { summary: "Extract URL content" }
    }
  }
};

app.get('/', (req, res) => {
  res.status(200).json(openApiSpec);
});

app.get('/openapi.json', (req, res) => {
  res.status(200).json(openApiSpec);
});

// 3. Existing REST Endpoints
app.post('/register', (req, res) => {
  const { wallet } = req.body || {};
  res.status(200).json({
    status: "registered",
    wallet: wallet || "anonymous-agent",
    timestamp: new Date().toISOString()
  });
});

app.post('/gateway', async (req, res) => {
  const { url } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: "Missing 'url' parameter" });
  }
  try {
    const response = await fetch(url);
    const text = await response.text();
    res.status(200).json({
      status: "success",
      url,
      content: text.substring(0, 10000)
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to extract URL", details: err.message });
  }
});

// 4. MCP JSON-RPC Handler (Supports both '/' and '/mcp' for Glama Health Checks)
const handleMcpRequest = async (req, res) => {
  const { method, id, params } = req.body || {};

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
    return res.status(200).end();
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
    id: id || null,
    result: {}
  });
};

app.post('/', handleMcpRequest);
app.post('/mcp', handleMcpRequest);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AgentGate MCP & REST Server running on port ${PORT}`);
});
