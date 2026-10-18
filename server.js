const express = require('express');
const Stripe = require('stripe');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());

const METER_EVENT_NAME = process.env.STRIPE_METER_EVENT_NAME || 'agentgate_api_requests';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_1URRekGVZIWD5CdlZefzBGLi';

app.get('/.well-known/agent.json', (req, res) => {
  res.json({
    agent_gate: "AgentGate M2M Web-Reader & Extraction Bridge",
    version: "3.0.0",
    protocol: "M2M-HTTP-402",
    pricing: {
      model: "per_request_metered_billing",
      price_id: STRIPE_PRICE_ID,
      event_name: METER_EVENT_NAME,
      currency: "usd"
    }
  });
});

app.get('/openapi.json', (req, res) => {
  res.json({
    openapi: "3.1.0",
    info: { title: "AgentGate M2M Web Extractor", version: "3.0.0" },
    servers: [{ url: "https://agentgate-production-15b2.up.railway.app" }],
    paths: {
      "/register": { post: { summary: "Register agent wallet" } },
      "/gateway": { post: { summary: "Extract URL content" } }
    }
  });
});

app.post('/register', async (req, res) => {
  try {
    const { agent_name } = req.body || {};
    const agentName = agent_name || `Autonomous-Agent-${Date.now()}`;

    const customer = await stripe.customers.create({
      name: agentName,
      description: 'M2M Autonomous Agent Wallet'
    });

    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: STRIPE_PRICE_ID }],
      success_url: `https://agentgate-production-15b2.up.railway.app/gateway?success=true&customer_id=${customer.id}`,
      cancel_url: `https://agentgate-production-15b2.up.railway.app/`,
    });

    res.status(201).json({
      success: true,
      status: "registered_payment_required",
      customer_id: customer.id,
      activation_url: session.url
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/gateway', async (req, res) => {
  const { customer_id, target_url } = req.body || {};

  if (!customer_id) {
    return res.status(402).json({ success: false, status: "payment_required", code: 402 });
  }

  if (!target_url || !target_url.startsWith('http')) {
    return res.status(400).json({ success: false, error: "Invalid target_url" });
  }

  try {
    const response = await fetch(target_url, {
      headers: { 'User-Agent': 'AgentGate-M2M-Extractor/3.0' },
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

    const meterEvent = await stripe.billing.meterEvents.create({
      event_name: METER_EVENT_NAME,
      payload: { stripe_customer_id: customer_id, value: '1' },
    });

    res.status(200).json({
      success: true,
      status: "access_granted",
      toll_receipt: { event_id: meterEvent.identifier, units_billed: 1 },
      extracted_data: { url: target_url, title: pageTitle, clean_text: cleanText }
    });
  } catch (error) {
    res.status(402).json({ success: false, status: "toll_failed", error: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({ service: "AgentGate M2M Web-Reader & Extraction Bridge", status: "online" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AgentGate running on port ${PORT}`));
