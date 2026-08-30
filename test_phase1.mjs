import http from 'http';

async function main() {
  console.log('Testing Zero Browser Worker on port 3001...');

  // 1. Health check
  console.log('\n--- 1. Testing GET /health ---');
  const healthRes = await fetch('http://127.0.0.1:3001/health');
  const healthData = await healthRes.json();
  console.log('Health Response:', JSON.stringify(healthData, null, 2));

  if (!healthData.chromiumVersion) {
    throw new Error('FAILED: chromiumVersion is empty!');
  }
  console.log('PASS: Chromium version verified:', healthData.chromiumVersion);

  // 2. Create session
  console.log('\n--- 2. Testing POST /sessions ---');
  const sessionRes = await fetch('http://127.0.0.1:3001/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'test-session-1' }),
  });
  const sessionData = await sessionRes.json();
  console.log('Session Created:', JSON.stringify(sessionData, null, 2));

  // 3. Navigate + Snapshot
  console.log('\n--- 3. Testing POST /sessions/test-session-1/action (navigate to https://example.com) ---');
  const actionRes = await fetch('http://127.0.0.1:3001/sessions/test-session-1/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'navigate',
      url: 'https://example.com',
    }),
  });
  const actionData = await actionRes.json();
  console.log('Navigate + Snapshot elements (first 3):', JSON.stringify(actionData.snapshot?.elements?.slice(0, 3), null, 2));

  if (!actionData.snapshot || actionData.snapshot.elements.length === 0) {
    throw new Error('FAILED: Snapshot contains no elements!');
  }
  console.log('PASS: Snapshot received with title:', actionData.snapshot.title);

  // 4. Clean up
  console.log('\n--- 4. Testing DELETE /sessions/test-session-1 ---');
  const deleteRes = await fetch('http://127.0.0.1:3001/sessions/test-session-1', {
    method: 'DELETE',
  });
  const deleteData = await deleteRes.json();
  console.log('Session Deleted:', JSON.stringify(deleteData, null, 2));

  console.log('\nALL PHASE 1 VERIFICATIONS PASSED SUCCESSFULLY!');
  process.exit(0);
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
