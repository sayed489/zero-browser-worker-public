import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface Session {
  id: string;
  context: BrowserContext;
  page: Page;
  createdAt: number;
  lastActionAt: number;
  idleTimer?: NodeJS.Timeout;
  lastSnapshot?: any;
}

export interface SessionManagerOptions {
  maxSessions: number;
  idleTimeoutMs: number;
  storagePath: string;
}

export class SessionManager {
  private browser!: Browser;
  private sessions = new Map<string, Session>();
  private opts: SessionManagerOptions;

  constructor(opts: SessionManagerOptions) {
    this.opts = opts;
  }

  get max(): number {
    return this.opts.maxSessions;
  }

  get count(): number {
    return this.sessions.size;
  }

  async init() {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // critical for Render/Docker/low-memory environments
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--no-first-run',
        '--mute-audio',
      ],
    });
  }

  async create(requestedId?: string, initialStorageState?: any): Promise<{ id: string }> {
    if (this.sessions.size >= this.opts.maxSessions) {
      throw new Error(`Session limit reached (${this.opts.maxSessions})`);
    }

    const id = requestedId ?? uuidv4();
    await fs.mkdir(this.opts.storagePath, { recursive: true });
    const storagePath = path.join(this.opts.storagePath, `${id}.json`);

    // Load persisted state if provided or if it exists on disk
    let storageState: any = initialStorageState;
    if (!storageState) {
      try {
        const data = await fs.readFile(storagePath, 'utf8');
        storageState = JSON.parse(data);
      } catch {
        /* fresh session */
      }
    }

    const context = await this.browser.newContext({
      storageState,
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    const session: Session = {
      id,
      context,
      page,
      createdAt: Date.now(),
      lastActionAt: Date.now(),
    };

    this.sessions.set(id, session);
    this._resetIdleTimer(id);
    return { id };
  }

  async get(id: string): Promise<Session> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    return session;
  }

  touch(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    session.lastActionAt = Date.now();
    this._resetIdleTimer(id);
  }

  async saveState(id: string) {
    const session = this.sessions.get(id);
    if (!session) return null;
    try {
      const state = await session.context.storageState();
      const storagePath = path.join(this.opts.storagePath, `${id}.json`);
      await fs.writeFile(storagePath, JSON.stringify(state), 'utf8');
      return state;
    } catch {
      return null;
    }
  }

  async loadState(id: string, state: any) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    if (state.cookies && Array.isArray(state.cookies)) {
      await session.context.addCookies(state.cookies).catch(() => {});
    }
  }

  async destroy(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    clearTimeout(session.idleTimer);
    await this.saveState(id);
    await session.context.close().catch(() => {});
    this.sessions.delete(id);
  }

  async destroyAll() {
    for (const id of Array.from(this.sessions.keys())) {
      await this.destroy(id);
    }
    await this.browser?.close().catch(() => {});
  }

  list(): Array<{ id: string; createdAt: number; lastActionAt: number; url: string }> {
    return Array.from(this.sessions.entries()).map(([id, s]) => ({
      id,
      createdAt: s.createdAt,
      lastActionAt: s.lastActionAt,
      url: s.page.url(),
    }));
  }

  private _resetIdleTimer(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      console.log(`[SessionManager] Session ${id} idle timeout — closing`);
      this.destroy(id);
    }, this.opts.idleTimeoutMs);
  }
}
