const express = require('express');
const Stripe = require('stripe');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());

const METER_EVENT_NAME = process.env.METER_EVENT_NAME || 'agentgate_api_requests';

// 1. MACHINE DISCOVERY ENDPOINT
// Passing AI agents query this to learn how to pay and use your gate
app.get('/.well-known/agent.json', (req, res) => {
  res.json({
    agent_gate: "AgentGate M2M Tollbooth",
    version: "1.0.0",
    protocol: "M2M-HTTP-402",
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
      pass_through_gate: {
        method: "POST",
        path: "/gateway",
        body: {
          customer_id: "string (cus_... ID from /register)",
          task_payload: "object (optional data/request for the gate)"
        }
      }
    }
  });
});

// 2. AUTO-PROVISIONING ENDPOINT (/register)
// Lets an AI agent create its own matching Stripe machine ID on the fly
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
      message: "Agent wallet provisioned. Pass this customer_id to /gateway.",
      customer_id: customer.id
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// 3. THE BOUNCER & TOLLBOOTH (/gateway)
app.post('/gateway', async (req, res) => {
  const { customer_id, task_payload } = req.body || {};

  // If an agent hits the gate without an ID, tell it how to register/pay
  if (!customer_id) {
    return res.status(402).json({
      success: false,
      status: "payment_required",
      code: 402,
      message: "M2M Toll Required. Provide a valid 'customer_id' or POST to '/register' to provision an agent wallet.",
      discovery_url: "/.well-known/agent.json"
    });
  }

  try {
    // Record the micro-toll in Stripe
    const meterEvent = await stripe.billing.meterEvents.create({
      event_name: METER_EVENT_NAME,
      payload: {
        stripe_customer_id: customer_id,
        value: '1',
      },
    });

    // Open the gate and return the receipt + payload
    res.status(200).json({
      success: true,
      status: "access_granted",
      message: "Metered event recorded. Toll paid.",
      toll_receipt: {
        event_id: meterEvent.identifier,
        customer_id: customer_id,
        units_billed: 1,
        timestamp: new Date().toISOString()
      },
      gate_response: {
        verified: true,
        echo_payload: task_payload || null
      }
    });
  } catch (error) {
    res.status(402).json({
      success: false,
      status: "toll_failed",
      error: error.message,
      hint: "Call POST /register first to generate a customer_id that matches this server's Stripe environment."
    });
  }
});

// Root status check
app.get('/', (req, res) => {
  res.json({
    service: "AgentGate M2M Tollbooth",
    status: "online",
    discovery: "/.well-known/agent.json"
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AgentGate running on port ${PORT}`));
