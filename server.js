const express = require('express');
const Stripe = require('stripe');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());

const METER_EVENT_NAME = process.env.STRIPE_METER_EVENT_NAME || 'agentgate_api_requests';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || 'Price_1URRekGVZIWD5CdlZefzBGLi';

// 1. MACHINE DISCOVERY ENDPOINT (Agent Manifest & OpenAPI/MCP Specs)
app.get('/.well-known/agent.json', (req, res) => {
  res.json({
    agent_gate: "AgentGate M2M Web-Reader & Extraction Bridge",
    version: "3.0.0",
    protocol: "M2M-HTTP-402",
    description: "Autonomous micro-toll web extraction for AI agents. Pass a customer_id and target_url to extract clean LLM-ready text.",
    pricing: {
      model: "per_request_metered_billing",
      price_id: STRIPE_PRICE_ID,
      event_name: METER_EVENT_NAME,
      currency: "usd"
    },
    endpoints: {
      register_agent: {
        method: "POST",
        path: "/register",
        body: {
          agent_name: "string (optional)"
        }
      },
      extract_url: {
        method: "POST",
        path: "/gateway",
        body: {
          customer_id: "string (required - cus_... ID from /register)",
          target_url: "string (required - full https:// URL to scrape)"
        }
      }
    }
  });
});

// 2. AUTO-PROVISIONING & PAYMENT LINK ENDPOINT (/register)
app.post('/register', async (req, res) => {
  try {
    const { agent_name } = req.body || {};
    const agentName = agent_name || `Autonomous-Agent-${Date.now()}`;

    // Create the customer
    const customer = await stripe.customers.create({
      name: agentName,
      description: 'M2M Autonomous Agent Wallet',
      metadata: {
        m2m_agent: 'true',
        registered_at: new Date().toISOString()
      }
    });

    // Create a Checkout Session tied to your metered price so the agent/owner can attach a card
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `https://agentgate-production-15be.up.railway.app/gateway?success=true&customer_id=${customer.id}`,
      cancel_url: `https://agentgate-production-15be.up.railway.app/`,
    });

    res.status(201).json({
      success: true,
      status: "registered_payment_required",
      message: "Agent wallet provisioned. Attach a payment method via the activation_url below to authorize toll passage.",
      customer_id: customer.id,
      activation_url: session.url
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// 3. THE TOLLBOOTH & WEB-EXTRACTION BRIDGE (/gateway)
app.post('/gateway', async (req, res) => {
  const { customer_id, target_url } = req.body || {};

  if (!customer_id) {
    return res.status(402).json({
      success: false,
      status: "payment_required",
      code: 402,
      message: "M2M Toll Required. Provide a valid 'customer_id' or POST to '/register' to provision an agent wallet.",
      discovery_url: "/.well-known/agent.json"
    });
  }

  if (!target_url || !target_url.startsWith('http')) {
    return res.status(400).json({
      success: false,
      error: "Missing or invalid 'target_url'. Provide a full URL starting with http:// or https://."
    });
  }

  try {
    // 1. Fetch and clean target URL
    const response = await fetch(target_url, {
      headers: {
        'User-Agent': 'AgentGate-M2M-Extractor/3.0 (+https://agentgate-production-15be.up.railway.app/.well-known/agent.json)'
      },
      signal: AbortSignal.timeout(8000)
    });

    const rawHtml = await response.text();
    const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : 'Untitled Page';

    const cleanText = rawHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10000);

    // 2. Record metered usage event in Stripe
    const meterEvent = await stripe.billing.meterEvents.create({
      event_name: METER_EVENT_NAME,
      payload: {
        stripe_customer_id: customer_id,
        value: '1',
      },
    });

    // 3. Respond with extracted data and toll receipt
    res.status(200).json({
      success: true,
      status: "access_granted",
      message: "Metered event recorded. URL extracted.",
      toll_receipt: {
        event_id: meterEvent.identifier,
        customer_id: customer_id,
        units_billed: 1,
        timestamp: new Date().toISOString()
      },
      extracted_data: {
        url: target_url,
        http_status: response.status,
        title: pageTitle,
        content_length: cleanText.length,
        clean_text: cleanText
      }
    });
  } catch (error) {
    res.status(402).json({
      success: false,
      status: "toll_or_extraction_failed",
      error: error.message
    });
  }
});

// Root status check
app.get('/', (req, res) => {
  res.json({
    service: "AgentGate M2M Web-Reader & Extraction Bridge",
    status: "online",
    discovery: "/.well-known/agent.json"
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AgentGate running on port ${PORT}`));
