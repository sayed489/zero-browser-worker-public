export function connectPageHTML(): string {
  const appUrl = process.env.APP_URL ?? 'https://www.zerolabs.live';
  const workerUrl = process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;
  const token = process.env.WORKER_TOKEN ?? '';
  const connectHref = `${appUrl}/api/connect-worker?url=${encodeURIComponent(workerUrl)}&token=${encodeURIComponent(token)}`;

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zero Browser Worker</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;
       justify-content:center;min-height:100vh;margin:0;background:#09090b;color:#f4f4f5}
  .card{background:#18181b;border:1px solid #27272a;border-radius:20px;
        padding:48px;max-width:440px;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.7)}
  h1{font-size:1.6rem;margin-bottom:.5rem;color:#ffffff;letter-spacing:-0.5px}
  p{color:#a1a1aa;margin-bottom:2rem;font-size:0.95rem;line-height:1.5}
  a.btn{display:inline-block;background:#00D4FF;color:#09090b;border:none;
        padding:14px 32px;border-radius:12px;font-size:1rem;font-weight:700;
        text-decoration:none;cursor:pointer;transition:transform 0.15s ease, background 0.15s ease;
        box-shadow:0 0 20px rgba(0,212,255,0.35)}
  a.btn:hover{background:#38e1ff;transform:translateY(-2px)}
  .status{color:#2dd4bf;font-size:.85rem;margin-top:1.5rem;font-weight:500}
  .badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;
         padding:4px 10px;background:#042f2e;color:#2dd4bf;border-radius:9999px;margin-bottom:16px;border:1px solid #115e59}
  .indicator{width:6px;height:6px;background:#2dd4bf;border-radius:50%;display:inline-block}
</style></head><body>
<div class="card">
  <div class="badge"><span class="indicator"></span> Real Chromium Engine Online</div>
  <h1>🌐 Browser Worker</h1>
  <p>This persistent worker is running and ready. Connect it to your account to start automating.</p>
  <a class="btn" href="${connectHref}">Connect to Zero Co-Work</a>
  <p class="status">✓ Chromium running · Worker v2.0.0</p>
</div></body></html>`;
}
