const express = require('express');
const Stripe = require('stripe');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());

app.post('/gateway', async (req, res) => {
  try {
    const { customer_id } = req.body;
    
    await stripe.billing.meterEvents.create({
      event_name: process.env.METER_EVENT_NAME || 'agentgate_api_requests',
      payload: {
        stripe_customer_id: customer_id,
        value: '1',
      },
    });

    res.status(200).json({ success: true, message: 'Metered event recorded.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AgentGate running on port ${PORT}`));
