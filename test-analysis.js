// Test script for profanity and criminal code analysis
const testMessage = {
  message_id: 12345,
  from: {
    id: 123456789,
    username: 'testuser',
    first_name: 'Test'
  },
  chat: {
    id: -1001234567890,
    type: 'supergroup'
  },
  date: Math.floor(Date.now() / 1000),
  text: 'я тебя убью гнида ебаная. тварь. пидорас ебучий'
};

const testUpdate = {
  update_id: 123456,
  message: testMessage
};

console.log('Testing message:', JSON.stringify(testUpdate, null, 2));

// Send test request to local server
// Using dummy token for testing - in real app this would be the actual bot token
fetch('http://localhost:8787/tg/production_token/webhook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Telegram-Bot-Api-Secret-Token': 'test_secret'
  },
  body: JSON.stringify(testUpdate)
})
.then(response => {
  console.log('Response status:', response.status);
  return response.text();
})
.then(text => {
  console.log('Response:', text);
})
.catch(error => {
  console.error('Error:', error);
});