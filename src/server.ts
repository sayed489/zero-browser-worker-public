import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import { SessionManager } from './sessionManager';
import { executeAction } from './executor';
import { ActionSchema } from './types';
import { takeSnapshot } from './snapshot';
import { startScreencast } from './screencast';
import { connectPageHTML } from './connectPage';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const sessionManager = new SessionManager({
  maxSessions: parseInt(process.env.MAX_SESSIONS ?? '3', 10),
  idleTimeoutMs: parseInt(process.env.IDLE_TIMEOUT_MS ?? '300000', 10),
  storagePath: process.env.STORAGE_PATH ?? './.sessions',
});

// ── Auth middleware (skip for public endpoints) ──────────────────────
const WORKER_TOKEN = process.env.WORKER_TOKEN;
app.use((req, res, next) => {
  if (['/health', '/'].includes(req.path)) return next();
  if (!WORKER_TOKEN) return next(); // In dev open if unset

  const headerToken = req.headers['x-worker-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const queryToken = req.query.token as string | undefined;
  const token = headerToken || queryToken;

  if (token !== WORKER_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

// ── GET / — Connect page ─────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(connectPageHTML());
});

// ── GET /health — REAL health check ─────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('about:blank');
    const version = browser.version();
    await browser.close();

    let pwVersion = '1.44.0';
    try {
      pwVersion = require('playwright/package.json').version;
    } catch {
      /* ignore */
    }

    res.json({
      status: 'ok',
      playwrightVersion: pwVersion,
      chromiumVersion: version,
      activeSessions: sessionManager.count,
      maxSessions: sessionManager.max,
      workerVersion: '2.0.0',
    });
  } catch (err: any) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// ── POST /sessions ───────────────────────────────────────────────────
app.post('/sessions', async (req, res) => {
  try {
    const requestedId = req.body?.sessionId || req.body?.id;
    const initialStorageState = req.body?.storageState;
    const initialUrl = req.body?.initialUrl;
    const result = await sessionManager.create(requestedId, initialStorageState);
    const session = await sessionManager.get(result.id);
    if (initialUrl && initialUrl !== 'about:blank') {
      await session.page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    res.json({
      sessionId: result.id,
      id: result.id,
      ok: true,
    });
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

// ── GET /sessions ────────────────────────────────────────────────────
app.get('/sessions', (_req, res) => {
  res.json(sessionManager.list());
});

// ── DELETE /sessions/:id ─────────────────────────────────────────────
app.delete('/sessions/:id', async (req, res) => {
  await sessionManager.destroy(req.params.id);
  res.json({ ok: true });
});

// ── GET /sessions/:id/snapshot ───────────────────────────────────────
app.get('/sessions/:id/snapshot', async (req, res) => {
  try {
    const session = await sessionManager.get(req.params.id);
    sessionManager.touch(req.params.id);
    const snapshot = await takeSnapshot(session.page);
    session.lastSnapshot = snapshot;
    res.json({
      title: snapshot.title,
      url: snapshot.url,
      elements: snapshot.elements,
      totalFound: snapshot.elements.length,
      snapshot,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /sessions/:id/screencast (SSE Fallback) ──────────────────────
app.get('/sessions/:id/screencast', async (req, res) => {
  let session;
  try {
    session = await sessionManager.get(req.params.id);
  } catch {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.write(': ping\n\n');

  const stop = await startScreencast(session.page, (frame) => {
    try {
      res.write(`data: ${frame}\n\n`);
    } catch {
      stop();
    }
  });

  req.on('close', () => {
    stop();
  });
});

// ── POST /sessions/:id/action ────────────────────────────────────────
app.post('/sessions/:id/action', async (req, res) => {
  const rawPayload = req.body.action || req.body;
  const actionPayload = { ...rawPayload };
  if (actionPayload.action && !actionPayload.type) {
    actionPayload.type = actionPayload.action;
  }
  if (actionPayload.press_enter && !actionPayload.pressEnter) {
    actionPayload.pressEnter = actionPayload.press_enter;
  }

  const parsed = ActionSchema.safeParse(actionPayload);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten(), received: actionPayload });
  }

  let session;
  try {
    session = await sessionManager.get(req.params.id);
  } catch {
    return res.status(404).json({ error: 'Session not found' });
  }

  sessionManager.touch(req.params.id);
  const snapshotToUse = req.body._lastSnapshot ?? session.lastSnapshot ?? null;
  const result = await executeAction(session.page, parsed.data, snapshotToUse);
  if (result.snapshot) {
    session.lastSnapshot = result.snapshot;
  }

  // Periodically save browser state
  setImmediate(() => sessionManager.saveState(req.params.id));

  res.json(result);
});

// ── GET /sessions/:id/state — save & return cookies/localStorage ─────
app.get('/sessions/:id/state', async (req, res) => {
  try {
    const session = await sessionManager.get(req.params.id);
    const state = await session.context.storageState();
    res.json(state);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// ── POST /sessions/:id/load-state — hydrate cookies/storage ──────────
app.post('/sessions/:id/load-state', async (req, res) => {
  try {
    await sessionManager.loadState(req.params.id, req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── WS /sessions/:id/screencast ─────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
  const match = pathname.match(/^\/sessions\/([^\/]+)\/screencast/);

  if (match) {
    const sessionId = match[1];
    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      wss.emit('connection', ws, request, sessionId);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', async (ws: WebSocket, _req: any, sessionId: string) => {
  let session: any;
  for (let i = 0; i < 10; i++) {
    try {
      session = await sessionManager.get(sessionId);
      if (session) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }

  if (!session) {
    try {
      await sessionManager.create(sessionId);
      session = await sessionManager.get(sessionId);
    } catch {
      ws.close(1008, 'Session not found');
      return;
    }
  }

  const stop = await startScreencast(session.page, (frame) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'frame', data: frame }));
    }
  });

  // Forward keyboard/mouse from client (for human takeover during CAPTCHA)
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ping') {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
        return;
      }
      if (msg.type === 'mouse_move' && msg.x !== undefined && msg.y !== undefined) {
        await session.page.mouse.move(msg.x, msg.y);
      } else if (msg.type === 'mouse_click' && msg.x !== undefined && msg.y !== undefined) {
        await session.page.mouse.click(msg.x, msg.y);
      } else if (msg.type === 'mouse_down') {
        await session.page.mouse.down();
      } else if (msg.type === 'mouse_up') {
        await session.page.mouse.up();
      } else if (msg.type === 'key_press' && msg.key) {
        await session.page.keyboard.press(msg.key);
      } else if (msg.type === 'type_text' && msg.text) {
        await session.page.keyboard.type(msg.text);
      } else if (msg.type === 'keyboard_press' && msg.key) {
        await session.page.keyboard.press(msg.key);
      } else if (msg.type === 'keyboard_type' && msg.text) {
        await session.page.keyboard.type(msg.text);
      } else if (msg.type === 'scroll' && msg.deltaY !== undefined) {
        await session.page.mouse.wheel(0, msg.deltaY);
      }
    } catch {
      /* ignore malformed input events */
    }
  });

  ws.on('close', () => {
    stop();
  });
});

// ── Start ────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3001', 10);

(async () => {
  await sessionManager.init();
  server.listen(PORT, () => {
    console.log(`[worker] Browser worker running on port ${PORT}`);
  });

  process.on('SIGTERM', async () => {
    console.log('[worker] SIGTERM — closing sessions');
    await sessionManager.destroyAll();
    process.exit(0);
  });
})();
