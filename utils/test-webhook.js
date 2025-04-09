import fetch from 'node-fetch';

const payload = {
  type: 'user.created',
  data: {
    id: 'user_test_123',
    first_name: 'Test',
    last_name: 'User',
    image_url: 'https://example.com/avatar.png',
    primary_email_address_id: 'email_1',
    email_addresses: [
      {
        id: 'email_1',
        email_address: 'testuser@example.com'
      }
    ]
  }
};

async function sendTestWebhook() {
  try {
    const res = await fetch('http://192.168.1.42:5000/webhooks/clerk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'svix-id': 'test-id',
        'svix-timestamp': `${Math.floor(Date.now() / 1000)}`,
        'svix-signature': 'test-signature'
      },
      body: JSON.stringify(payload)
    });
    
    const status = res.status;
    let responseData;
    
    try {
      responseData = await res.json();
      console.log(`Response (${status}):`, responseData);
    } catch (e) {
      const text = await res.text();
      console.log(`Response (${status}):`, text);
    }
  } catch (err) {
    console.error('Error saat kirim test webhook:', err);
  }
}

sendTestWebhook();