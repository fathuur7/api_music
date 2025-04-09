import express from 'express';
import { Webhook } from 'svix';
import { handleClerkWebhook } from '../utils/clerk-webhook-handler.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Make sure the path matches what Clerk is trying to access
router.post('/webhooks/clerk', express.json(), async (req, res) => {
  try {
    let payload = req.body;
    const isDev = process.env.NODE_ENV === 'development';

    if (!isDev) {
      // Only verify the webhook in production
      const svixHeaders = {
        'svix-id': req.headers['svix-id'],
        'svix-timestamp': req.headers['svix-timestamp'],
        'svix-signature': req.headers['svix-signature'],
      };

      const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET);
      // Convert payload to string if it's not already
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      payload = wh.verify(rawBody, svixHeaders);
    }
    
    console.log('[Webhook received]', payload.type);
    
    // Handle Clerk event
    await handleClerkWebhook(payload.type, payload.data);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;