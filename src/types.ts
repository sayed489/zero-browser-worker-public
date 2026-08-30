import { z } from 'zod';

// ── Snapshot ────────────────────────────────────────────────────────
export interface SnapshotElement {
  ref: number;          // stable integer this turn, 1-based
  role: string;         // AX role: button, link, textbox, etc.
  name: string;         // accessible name (aria-label, text content, etc.)
  value?: string;       // current value for inputs
  checked?: boolean;    // for checkboxes/radios
  disabled?: boolean;
  focused?: boolean;
  bbox?: { x: number; y: number; width: number; height: number };
  tag?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  elements: SnapshotElement[];
  timestamp: number;
}

// ── Actions ─────────────────────────────────────────────────────────
export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'),   url: z.string() }),
  z.object({ type: z.literal('click'),      ref: z.number().int().positive() }),
  z.object({ type: z.literal('type'),       ref: z.number().int().positive(), text: z.string() }),
  z.object({ type: z.literal('clear'),      ref: z.number().int().positive() }),
  z.object({ type: z.literal('scroll'),     direction: z.enum(['up', 'down', 'left', 'right']), amount: z.number().default(300) }),
  z.object({ type: z.literal('wait'),       ms: z.number().int().min(100).max(10000) }),
  z.object({ type: z.literal('snapshot') }),
  z.object({ type: z.literal('extract'),    ref: z.number().int().positive() }),
  z.object({ type: z.literal('hover'),      ref: z.number().int().positive() }),
  z.object({ type: z.literal('press'),      key: z.string() }),
  z.object({ type: z.literal('select'),     ref: z.number().int().positive(), value: z.string() }),
  z.object({ type: z.literal('web_search'), query: z.string().min(1).max(500) }),
]);
export type Action = z.infer<typeof ActionSchema>;

// ── Action Result ────────────────────────────────────────────────────
export interface ActionResult {
  ok: boolean;
  snapshot?: PageSnapshot;
  extracted?: string;
  error?: string;
  // For cursor animation in the UI:
  clickedBbox?: { x: number; y: number; width: number; height: number };
}

// ── Session ──────────────────────────────────────────────────────────
export interface SessionMeta {
  id: string;
  createdAt: number;
  lastActionAt: number;
  url: string;
}
