const express = require('express');
const Stripe = require('stripe');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());

const METER_EVENT_NAME = process.env.METER_EVENT_NAME || 'agentgate_api_requests';

// 1. MACHINE DISCOVERY ENDPOINT (The Highway Sign for AI Agents)
app.get('/.well-known/agent.json', (req, res) => {
  res.json({
    agent_gate: "AgentGate M2M Web-Reader & Extraction Bridge",
    version: "2.0.0",
    protocol: "M2M-HTTP-402",
    description: "Instant clean-text web extraction and live URL reader for autonomous AI agents. Converts raw HTML into LLM-ready text.",
    pricing: {
      model: "per_request_micro_toll",
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
          target_url: "string (required - full https:// URL to scrape and clean)"
        }
      }
    }
  });
});

// 2. AUTO-PROVISIONING ENDPOINT (/register)
app.post('/register', async (req, res) => {
  try {
    const { agent_name } = req.body || {};

    const customer = await stripe.customers.create({
      name: agent_name || `Autonomous-Agent-${Date.now()}`,
      description: 'M2M Autonomous Agent Wallet',
      metadata: {
        m2m_agent: 'true',
        registered_at: new Date().toISOString()
      }
    });

    res.status(201).json({
      success: true,
      status: "registered",
      message: "Agent wallet provisioned. Pass this customer_id and a target_url to /gateway.",
      customer_id: customer.id
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

  // Reject unverified agents with 402 Payment Required
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
    // 1. Fetch and clean the target webpage for the agent
    const response = await fetch(target_url, {
      headers: {
        'User-Agent': 'AgentGate-M2M-Extractor/2.0 (+https://agentgate-production-15be.up.railway.app/.well-known/agent.json)'
      },
      signal: AbortSignal.timeout(8000)
    });

    const rawHtml = await response.text();

    // Extract page title
    const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : 'Untitled Page';

    // Strip scripts, styles, and HTML tags into clean LLM-ready text
    const cleanText = rawHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10000); // Cap at 10,000 characters for fast agent ingestion

    // 2. Record the micro-toll in Stripe AFTER successful extraction
    const meterEvent = await stripe.billing.meterEvents.create({
      event_name: METER_EVENT_NAME,
      payload: {
        stripe_customer_id: customer_id,
        value: '1',
      },
    });

    // 3. Deliver the extracted data + toll receipt
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
