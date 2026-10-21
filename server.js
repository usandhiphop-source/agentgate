const express = require('express');
const Stripe = require('stripe');

const app = express();
app.use(express.json());

// Auto-detect your Railway variables (even if named METER_EVENT_NAME or STRIPE_SECRET_KEY)
const stripeKey =
  process.env.STRIPE_SECRET_KEY ||
  process.env.STRIPE_API_KEY ||
  process.env.STRIPE_KEY ||
  Object.values(process.env).find(v => typeof v === 'string' && (v.startsWith('rk_live_') || v.startsWith('sk_live_')));

const stripe = stripeKey ? new Stripe(stripeKey.trim()) : null;

const STRIPE_PRICE_ID =
  process.env.STRIPE_PRICE_ID ||
  process.env.PRICE_ID ||
  'price_1URRekGVZIWD5CdlZefzBGLi';

const STRIPE_METER_EVENT_NAME =
  process.env.STRIPE_METER_EVENT_NAME ||
  process.env.METER_EVENT_NAME ||
  process.env.METER_NAME ||
  'agentgate_api_requests';

const PUBLIC_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.PUBLIC_URL || 'https://agentgate-production-15b2.up.railway.app');

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

// Lightweight IP Rate Limiter (Max 60 requests/min per IP to prevent abuse)
const rateLimitMap = new Map();
app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const record = rateLimitMap.get(ip) || { count: 0, start: now };

  if (now - record.start > windowMs) {
    record.count = 1;
    record.start = now;
  } else {
    record.count += 1;
  }
  rateLimitMap.set(ip, record);

  if (record.count > 60) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  next();
});

const PORT = process.env.PORT || 8080;

// Security Helper: SSRF & Internal Network Protection
function isSafePublicUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;

    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '[::1]' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      host.endsWith('.internal') ||
      host.endsWith('.local')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Helper: Find Stripe Customer by Wallet Address & Check Active Subscription
async function getVerifiedStripeCustomer(wallet) {
  if (!stripe) throw new Error('Stripe API key is missing in Railway environment variables.');
  const cleanWallet = String(wallet).trim();

  const search = await stripe.customers.search({
    query: `metadata['wallet']:'${cleanWallet.replace(/'/g, '')}'`,
    limit: 1
  });

  if (!search.data.length) {
    return { customer: null, active: false };
  }

  const customer = search.data[0];
  const subs = await stripe.subscriptions.list({
    customer: customer.id,
    status: 'active',
    limit: 1
  });

  return {
    customer,
    active: subs.data.length > 0,
    subscriptionId: subs.data[0]?.id || null
  };
}

// Helper: Record a Paid Meter Event in Stripe
async function recordStripeMeterUsage(customerId) {
  if (!stripe || !customerId) return;
  try {
    await stripe.billing.meterEvents.create({
      event_name: STRIPE_METER_EVENT_NAME,
      payload: {
        stripe_customer_id: customerId,
        value: '1'
      }
    });
  } catch (err) {
    console.error('Meter event warning:', err.message);
  }
}

// 1. Glama Ownership Verification Route
app.get('/.well-known/glama.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({
    "$schema": "https://glama.ai/mcp/schemas/connector.json",
    "claim": "glama_claim_PQLFXmVfkhqAn4n9dNbVmsunPEBgKAEn"
  }));
});

// 2. High-TDQS MCP Tool Definitions (With Paid Wallet Enforcement)
const MCP_TOOLS = [
  {
    name: "extract_url_content",
    title: "Extract Webpage Content",
    description: "Fetches and extracts clean text or raw HTML content from any public HTTP/HTTPS webpage URL via the paid AgentGate M2M web extraction gateway. Requires a registered agent wallet with an active Stripe billing subscription.",
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
        wallet: {
          type: "string",
          description: "The registered agent wallet address with an active AgentGate Stripe subscription.",
          minLength: 3,
          maxLength: 128
        },
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
      required: ["wallet", "url"]
    }
  },
  {
    name: "register_agent_wallet",
    title: "Register Agent Wallet",
    description: "Registers an autonomous agent wallet with the AgentGate network and generates a Stripe Checkout billing URL to activate metered M2M gateway access.",
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
    description: "Checks the Stripe subscription status, billing readiness, and active tier of an agent wallet address on the AgentGate M2M network.",
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
    description: "Retrieves real-time operational status, Stripe billing gateway connectivity, protocol version, and uptime metrics for the AgentGate M2M Web Extractor service.",
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
          version: "3.2.0"
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

    // TOOL 1: Register Wallet & Generate Stripe Checkout Link
    if (toolName === 'register_agent_wallet') {
      try {
        const wallet = String(args.wallet || '').trim();
        const agentName = args.agent_name || 'autonomous-agent';

        const { customer: existingCustomer, active } = await getVerifiedStripeCustomer(wallet);

        if (existingCustomer && active) {
          return res.status(200).json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "already_active",
                  wallet,
                  stripe_customer_id: existingCustomer.id,
                  message: "Wallet already has an active metered subscription. Ready to extract."
                })
              }]
            }
          });
        }

        const customer = existingCustomer || await stripe.customers.create({
          name: agentName,
          metadata: { wallet, agent_name: agentName }
        });

        const session = await stripe.checkout.sessions.create({
          mode: 'subscription',
          customer: customer.id,
          line_items: [{ price: STRIPE_PRICE_ID }],
          success_url: `${PUBLIC_URL}/?payment=success&wallet=${encodeURIComponent(wallet)}`,
          cancel_url: `${PUBLIC_URL}/?payment=cancelled&wallet=${encodeURIComponent(wallet)}`,
          metadata: { wallet }
        });

        return res.status(200).json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "payment_required",
                wallet,
                stripe_customer_id: customer.id,
                checkout_url: session.url,
                instructions: "Complete Stripe Checkout at checkout_url to activate metered gateway access for this wallet."
              })
            }]
          }
        });
      } catch (err) {
        return res.status(200).json({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: `Registration error: ${err.message}` }]
          }
        });
      }
    }

    // TOOL 2: Check Wallet Stripe Subscription Status
    if (toolName === 'get_agent_wallet_status') {
      try {
        const { customer, active, subscriptionId } = await getVerifiedStripeCustomer(args.wallet);
        return res.status(200).json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{
              type: "text",
              text: JSON.stringify({
                wallet: args.wallet,
                registered: Boolean(customer),
                paid_subscription_active: active,
                stripe_customer_id: customer?.id || null,
                subscription_id: subscriptionId,
                status: active ? "active_paid" : "unpaid_or_unregistered",
                checked_at: new Date().toISOString()
              })
            }]
          }
        });
      } catch (err) {
        return res.status(200).json({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: `Status check error: ${err.message}` }]
          }
        });
      }
    }

    // TOOL 3: Gateway Health Check
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
              version: "3.2.0",
              billing_engine: stripe ? "stripe_metered_active" : "stripe_missing_key",
              meter_event: STRIPE_METER_EVENT_NAME,
              price_id: STRIPE_PRICE_ID,
              ...(args.verbose ? { timestamp: new Date().toISOString(), uptime_seconds: Math.floor(process.uptime()) } : {})
            })
          }]
        }
      });
    }

    // TOOL 4: Paid URL Extraction (Requires Active Stripe Subscription)
    if (toolName === 'extract_url_content') {
      const maxLen = args.max_length || 5000;
      try {
        if (!args.wallet) {
          throw new Error("Payment Required: Missing 'wallet' parameter. Call register_agent_wallet first.");
        }
        if (!isSafePublicUrl(args.url)) {
          throw new Error("Blocked: Only public HTTP/HTTPS URLs are permitted.");
        }

        // Verify Active Paid Subscription in Stripe
        const { customer, active } = await getVerifiedStripeCustomer(args.wallet);
        if (!customer || !active) {
          throw new Error(`Payment Required: Wallet '${args.wallet}' does not have an active Stripe subscription. Call register_agent_wallet to get a Stripe Checkout activation link.`);
        }

        const response = await fetch(args.url);
        const text = await response.text();

        // Bill 1 Metered Extraction Unit (agentgate_api_requests) to Customer in Stripe
        await recordStripeMeterUsage(customer.id);

        return res.status(200).json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{
              type: "text",
              text: text.substring(0, maxLen)
            }]
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

// 4. Existing OpenAPI & REST Endpoints (Also Enforcing Stripe Payment)
const openApiSpec = {
  openapi: "3.1.0",
  info: { title: "AgentGate M2M Web Extractor", version: "3.2.0" },
  servers: [{ url: PUBLIC_URL }],
  paths: {
    "/register": { post: { summary: "Register agent wallet and get Stripe Checkout URL" } },
    "/gateway": { post: { summary: "Extract URL content (Requires paid wallet)" } }
  }
};

app.get('/', (req, res) => res.status(200).json(openApiSpec));
app.get('/openapi.json', (req, res) => res.status(200).json(openApiSpec));

app.post('/register', async (req, res) => {
  try {
    const { wallet, agent_name } = req.body || {};
    if (!wallet) return res.status(400).json({ error: "Missing 'wallet' parameter" });

    const { customer: existingCustomer, active } = await getVerifiedStripeCustomer(wallet);
    if (existingCustomer && active) {
      return res.status(200).json({ status: "already_active", wallet, stripe_customer_id: existingCustomer.id });
    }

    const customer = existingCustomer || await stripe.customers.create({
      name: agent_name || 'autonomous-agent',
      metadata: { wallet }
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: STRIPE_PRICE_ID }],
      success_url: `${PUBLIC_URL}/?payment=success&wallet=${encodeURIComponent(wallet)}`,
      cancel_url: `${PUBLIC_URL}/?payment=cancelled&wallet=${encodeURIComponent(wallet)}`,
      metadata: { wallet }
    });

    res.status(200).json({ status: "payment_required", wallet, checkout_url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/gateway', async (req, res) => {
  const { url, wallet } = req.body || {};
  if (!wallet) return res.status(402).json({ error: "Payment Required: Missing 'wallet' parameter" });
  if (!url) return res.status(400).json({ error: "Missing 'url' parameter" });
  if (!isSafePublicUrl(url)) {
    return res.status(403).json({ error: "Blocked: Only public HTTP/HTTPS URLs are permitted." });
  }
  try {
    const { customer, active } = await getVerifiedStripeCustomer(wallet);
    if (!customer || !active) {
      return res.status(402).json({ error: "Payment Required: Active Stripe subscription required for this wallet." });
    }
    const response = await fetch(url);
    const text = await response.text();
    await recordStripeMeterUsage(customer.id);
    res.status(200).json({ status: "success", url, billed_to: customer.id, content: text.substring(0, 10000) });
  } catch (err) {
    res.status(500).json({ error: "Failed to extract URL", details: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
          
