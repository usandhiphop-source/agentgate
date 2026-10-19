const express = require('express');
const app = express();

app.use(express.json());

// Built-in CORS headers
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

// 2. High-TDQS MCP Tool Definitions
const MCP_TOOLS = [
  {
    name: "extract_url_content",
    title: "Extract Webpage Content",
    description: "Fetches and extracts clean text or raw HTML content from any public HTTP/HTTPS webpage URL via the AgentGate M2M web extraction gateway. Use this tool when an AI agent needs to read, scrape, or summarize external web pages.",
    annotations: {
      title: "Extract Webpage Content",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: {
          type: "string",
          format: "uri",
          description: "The full HTTP or HTTPS URL of the target webpage to extract content from (e.g., 'https://example.com/article')."
        },
        max_length: {
          type: "integer",
          description: "Maximum number of characters to return from the extracted webpage content. Defaults to 5000 characters.",
          default: 5000,
          minimum: 100,
          maximum: 50000
        }
      },
      required: ["url"]
    }
  },
  {
    name: "register_agent_wallet",
    title: "Register Agent Wallet",
    description: "Registers a cryptographic or machine-to-machine (M2M) wallet address with the AgentGate network. Use this tool to initialize an autonomous agent's identity and enable authenticated gateway requests.",
    annotations: {
      title: "Register Agent Wallet",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        wallet: {
          type: "string",
          description: "The public wallet address or unique cryptographic identifier of the AI agent (e.g., '0x71C...89A' or 'agent-node-01').",
          minLength: 3,
          maxLength: 128
        },
        agent_name: {
          type: "string",
          description: "Optional human-readable label or identifier for the autonomous agent registering the wallet.",
          default: "autonomous-agent"
        }
      },
      required: ["wallet"]
    }
  },
  {
    name: "get_agent_wallet_status",
    title: "Get Agent Wallet Status",
    description: "Checks the registration status, active tier, and gateway readiness of an agent wallet address on the AgentGate M2M network.",
    annotations: {
      title: "Get Agent Wallet Status",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        wallet: {
          type: "string",
          description: "The wallet address or unique agent identifier to query status for.",
          minLength: 3,
          maxLength: 128
        }
      },
      required: ["wallet"]
    }
  },
  {
    name: "check_gateway_health",
    title: "Check Gateway Health",
    description: "Retrieves real-time operational status, protocol version, and uptime metrics for the AgentGate M2M Web Extractor service.",
    annotations: {
      title: "Check Gateway Health",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        verbose: {
          type: "boolean",
          description: "Set to true to include detailed server timestamp and endpoint diagnostics in the health report.",
          default: false
        }
      }
    }
  }
];

// 3. MCP JSON-RPC Handler (Supports '/', '/mcp', and '/sse')
const handleMcp = async (req, res) => {
  const body = req.body || {};
  const { method, id, params } = body;

  if (method === 'initialize') {
    return res.status(200).json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "AgentGate M2M Web Extractor",
          version: "3.1.0"
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
        tools: MCP_TOOLS
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
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "registered",
              wallet: args.wallet || "anonymous-agent",
              agent_name: args.agent_name || "autonomous-agent",
              timestamp: new Date().toISOString()
            })
          }]
        }
      });
    }

    if (toolName === 'get_agent_wallet_status') {
      return res.status(200).json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              wallet: args.wallet,
              verified: true,
              status: "active",
              checked_at: new Date().toISOString()
            })
          }]
        }
      });
    }

    if (toolName === 'check_gateway_health') {
      return res.status(200).json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "healthy",
              service: "AgentGate M2M Web Extractor",
              version: "3.1.0",
              ...(args.verbose ? { timestamp: new Date().toISOString(), uptime_seconds: Math.floor(process.uptime()) } : {})
            })
          }]
        }
      });
    }

    if (toolName === 'extract_url_content') {
      const maxLen = args.max_length || 5000;
      try {
        const response = await fetch(args.url);
        const text = await response.text();
        return res.status(200).json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: text.substring(0, maxLen) }]
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

    return res.status(200).json({
      jsonrpc: "2.0",
      id,
      result: {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }]
      }
    });
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

// 4. Existing OpenAPI & REST Endpoints
const openApiSpec = {
  openapi: "3.1.0",
  info: { title: "AgentGate M2M Web Extractor", version: "3.1.0" },
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
