async function main() {
  console.log('Testing Phase 2 with Real Browser Worker and JS-heavy / live site...');

  // 1. Create session
  const sessionRes = await fetch('http://127.0.0.1:3001/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'phase2-test-session' }),
  });
  const sessionData = await sessionRes.json();
  console.log('Session Created:', sessionData.sessionId);

  // 2. Navigate to https://github.com/trending or https://news.ycombinator.com
  console.log('Navigating to https://github.com/trending ...');
  const actionRes = await fetch('http://127.0.0.1:3001/sessions/phase2-test-session/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'navigate',
      url: 'https://github.com/trending',
    }),
  });
  const actionData = await actionRes.json();

  if (!actionData.ok || !actionData.snapshot) {
    throw new Error('Action failed: ' + JSON.stringify(actionData));
  }

  const links = actionData.snapshot.elements.filter((el) => el.role === 'link');
  console.log(`Found ${links.length} interactive links in AX tree.`);
  console.log('First 5 links:', JSON.stringify(links.slice(0, 5), null, 2));

  if (links.length < 3) {
    throw new Error('FAILED: Expected at least 3 links in AX snapshot!');
  }

  // 3. Clean up
  await fetch('http://127.0.0.1:3001/sessions/phase2-test-session', { method: 'DELETE' });
  console.log('\nPHASE 2 VERIFICATION PASSED SUCCESSFULLY!');
  process.exit(0);
}

main().catch((err) => {
  console.error('PHASE 2 VERIFICATION FAILED:', err);
  process.exit(1);
});
