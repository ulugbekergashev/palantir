import type { BrainView, Call, Camera, CameraSummary, CameraTiming, CameraZone, ClinicDay, ZoneNow } from '../types';
import type { PriceLine } from '../lib/prices';
import type { AutoReply, Business, ChatEntry, Doc, InboxMessage, InboxThread, Lead, LeadStage, LiveStatus, MoneyEntry, Note, Outbound, ReplyDraft, Task, TaskStatus } from '../types';

/** Server bilan ishlash. Token — shu brauzerda */
const TOKEN_KEY = 'cerebro_token';
const ADMIN_KEY = 'cerebro_admin_token';

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, v: string | null) => {
  try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key); } catch { /* yopiq xotira */ }
};

export const session = {
  token: () => read(TOKEN_KEY),
  set: (t: string | null) => write(TOKEN_KEY, t),
  adminToken: () => read(ADMIN_KEY),
  setAdmin: (t: string | null) => write(ADMIN_KEY, t),
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function send(path: string, init: RequestInit, admin = false): Promise<Response> {
  const token = admin ? session.adminToken() : session.token();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }).catch(() => { throw new ApiError("Server bilan aloqa yo'q", 0); });
  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as { error?: string; details?: string[] };
    // Sessiya tugagan — qayta kirish sahifasiga
    if (res.status === 401 && !admin && token && path !== '/login') {
      session.set(null);
      window.location.reload();
    }
    const detail = Array.isArray(json.details) && json.details[0] ? ` (${json.details[0]})` : '';
    throw new ApiError(`${json.error || `Xato (${res.status})`}${detail}`, res.status);
  }
  return res;
}

async function call<T>(path: string, opts: { method?: string; body?: unknown; admin?: boolean } = {}): Promise<T> {
  const res = await send(path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json' },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }, opts.admin);
  return await res.json() as T;
}

export const api = {
  login: (login: string, password: string) => call<{ token: string }>('/login', { body: { login, password } }),
  me: () => call<{ business: Business; status: LiveStatus; offeringsRev: string }>('/me'),
  /** offeringsRev — xizmatlar ro'yxatining panel yuklagan nusxasi: shu orada boshqa joyda o'zgargan bo'lsa server rad etadi */
  saveBusiness: (b: Business, offeringsRev?: string) => call<{ business: Business; offeringsRev: string }>('/business', { method: 'PUT', body: { ...b, offeringsRev } }),

  /** interview — birinchi kun suhbati ochiq: keyingi xabar yordamchiga emas, savolga javob bo'lib ketadi */
  chat: () => call<{ entries: ChatEntry[]; interview: boolean }>('/chat'),
  say: (text: string) => call<{ entries: ChatEntry[]; interview: boolean }>('/chat', { body: { text } }),
  sayVoice: async (wav: Blob) => (await send('/chat/voice', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav })).json() as Promise<{ entries: ChatEntry[]; interview: boolean }>,
  interview: (action: 'start' | 'skip' | 'stop') => call<{ entries: ChatEntry[]; open: boolean }>('/brain/interview', { body: { action } }),
  /** Fayl (PDF, Word, Excel, matn) → o'qiladi va «Ikkinchi miya»da tasdiq kutadi */
  sayFile: async (file: File) => (await send(`/chat/file?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file })).json() as Promise<{ entries: ChatEntry[]; suggestion: string }>,
  resetChat: () => call<{ ok: true }>('/chat/reset', { body: {} }),

  tasks: (status: TaskStatus | 'all' = 'all') => call<{ tasks: Task[] }>(`/tasks?status=${status}`),
  addTask: (t: { title: string; dueAt: string | null; notes?: string | null }) => call<{ task: Task }>('/tasks', { body: t }),
  updateTask: (id: string, patch: Partial<Pick<Task, 'title' | 'dueAt' | 'notes' | 'status'>>) => call<{ task: Task }>(`/tasks/${id}`, { method: 'PATCH', body: patch }),

  updateLead: (id: string, patch: { stage?: LeadStage; note?: string | null; phone?: string | null; name?: string | null }) =>
    call<{ lead: Lead }>(`/leads/${id}`, { method: 'PATCH', body: patch }),
  followups: () => call<{ followups: Outbound[] }>('/followups'),
  sendFollowup: (id: string) => call<{ sent: number; failed: number; followup: Outbound }>(`/followups/${id}/send`, { body: {} }),
  /** DentaCRM pul yozuvi: confirm — yozish, cancel — bekor, undo — shu kuni ortga qaytarish */
  cameras: () => call<{ cameras: Camera[]; timing: CameraTiming }>('/cameras'),
  observe: (id: string, people: { x: number; y: number; w: number; h: number }[]) => call<{ zones: Record<string, ZoneNow> }>(`/cameras/${id}/observe`, { body: { people } }),
  addCamera: (name: string) => call<{ camera: Camera }>('/cameras', { body: { name } }),
  saveZones: (id: string, zones: (Omit<CameraZone, 'id'> & { id?: string })[]) => call<{ camera: Camera }>(`/cameras/${id}/zones`, { method: 'PUT', body: { zones } }),
  removeCamera: (id: string) => call<{ ok: true }>(`/cameras/${id}`, { method: 'DELETE' }),
  cameraSummary: () => call<{ summary: CameraSummary }>('/cameras/summary'),
  /** IP kamerani ulash (rtsp://…) yoki uzish (bo'sh satr). Server avval kadr olib ko'radi — manzil xato bo'lsa shu yerda aytadi */
  setCameraStream: (id: string, url: string) => call<{ camera: Camera }>(`/cameras/${id}/stream`, { method: 'PUT', body: { url } }),
  /** IP kameraning hozirgi kadri (zonalarni uning ustida chizish uchun) */
  cameraSnapshot: async (id: string) => (await send(`/cameras/${id}/snapshot`, { method: 'GET' })).blob(),
  calls: () => call<{ calls: Call[] }>('/calls'),
  voiceKey: () => call<{ exists: boolean }>('/voice/key'),
  newVoiceKey: () => call<{ key: string }>('/voice/key', { body: {} }),
  money: (id: string, verb: 'confirm' | 'cancel' | 'undo') => call<{ entry: MoneyEntry }>(`/crm/money/${id}/${verb}`, { body: {} }),
  cancelFollowup: (id: string) => call<{ followup: Outbound }>(`/followups/${id}/cancel`, { body: {} }),

  documents: () => call<{ documents: Doc[] }>('/documents'),
  documentFile: async (id: string) => (await send(`/documents/${id}/docx`, { method: 'GET' })).blob(),

  deletePost: (id: string) => call<{ ok: true }>(`/posts/${id}`, { method: 'DELETE' }),

  brain: () => call<{ brain: BrainView }>('/brain'),
  answer: (body: { question?: string; answer: string; packId?: string }) => call<{ brain: BrainView }>('/brain/qa', { body }),
  editKnowledge: (id: string, patch: { question?: string; answer?: string; remember?: true }) => call<{ brain: BrainView }>(`/brain/${id}`, { method: 'PATCH', body: patch }),
  removeKnowledge: (id: string) => call<{ brain: BrainView }>(`/brain/${id}`, { method: 'DELETE' }),
  addSample: (title: string, text: string) => call<{ brain: BrainView }>('/brain/samples', { body: { title, text } }),
  setStyle: (style: string) => call<{ brain: BrainView }>('/brain/style', { method: 'PUT', body: { style } }),
  removePrice: (id: string) => call<{ brain: BrainView }>(`/brain/prices/${id}`, { method: 'DELETE' }),
  pricesFromFile: (id: string) => call<{ brain: BrainView; added: number; updated: number; dropped: number; free: number }>(`/brain/${id}/prices`, { body: {} }),
  sampleFromFile: (id: string) => call<{ brain: BrainView }>(`/brain/${id}/sample`, { body: {} }),
  importPrices: (items: PriceLine[]) => call<{ brain: BrainView; added: number; updated: number; dropped: number; free: number }>('/brain/prices', { body: { items } }),

  addNote: (text: string) => call<{ note: Note }>('/notes', { body: { text } }),
  deleteNote: (id: string) => call<{ ok: true }>(`/notes/${id}`, { method: 'DELETE' }),

  inbox: () => call<{ threads: InboxThread[]; settings: AutoReply }>('/inbox'),
  thread: (leadId: string) => call<{ lead: Lead; messages: InboxMessage[]; replies: ReplyDraft[] }>(`/inbox/${leadId}`),
  /** replyId — shu tayyor javob tahrirlab yuborilyapti (Cerebro farqidan o'rganadi) */
  writeTo: (leadId: string, text: string, replyId?: string | null) => call<{ messages: InboxMessage[]; replies: ReplyDraft[] }>(`/inbox/${leadId}/send`, { body: { text, ...(replyId ? { replyId } : {}) } }),
  sendReply: (id: string) => call<{ ok: true }>(`/replies/${id}/send`, { body: {} }),
  dismissReply: (id: string) => call<{ ok: true }>(`/replies/${id}/dismiss`, { body: {} }),
  setAutoReply: (v: AutoReply) => call<{ business: Business }>('/business/auto-reply', { method: 'PUT', body: v }),

  tgStart: (phone: string) => call<{ ok: true }>('/telegram-user/start', { body: { phone } }),
  tgCode: (code: string) => call<{ account?: string; password?: true }>('/telegram-user/code', { body: { code } }),
  tgPassword: (password: string) => call<{ account: string }>('/telegram-user/password', { body: { password } }),
  tgDisconnect: () => call<{ status: LiveStatus }>('/telegram-user', { method: 'DELETE' }),
  crmConnect: (v: { url: string; username: string; password: string }) => call<{ status: LiveStatus }>('/crm', { body: v }),
  crmDisconnect: () => call<{ status: LiveStatus }>('/crm', { method: 'DELETE' }),
  /** Klinikaning kuni (bosh sahifa). 409 — DentaCRM ulanmagan, 502 — javob bermayapti */
  crmDay: (date?: string) => call<{ day: ClinicDay }>(`/crm/day${date ? `?date=${date}` : ''}`),
  igLogin: () => call<{ status: LiveStatus }>('/instagram/login', { body: {} }),
  igCancel: () => call<{ ok: true }>('/instagram/cancel', { body: {} }),
  igDisconnect: () => call<{ status: LiveStatus }>('/instagram', { method: 'DELETE' }),

};

export interface AdminBusiness {
  id: string;
  login: string;
  name: string;
  industry: string;
  active: boolean;
  createdAt: string;
  ownerLinked: boolean;
  channel: string | null;
}

/** Bir biznesning bir kunlik AI xarajati (taxminiy dollar — server narxlar jadvalidan hisoblaydi) */
export interface AdminUsage { day: string; businessId: string; business: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; usd: number }

export const adminApi = {
  login: (password: string) => call<{ token: string }>('/admin/login', { body: { password }, admin: true }),
  businesses: () => call<{ businesses: AdminBusiness[] }>('/admin/businesses', { admin: true }),
  create: (b: { name: string; industry: string; login: string; password: string }) => call<{ id: string }>('/admin/businesses', { body: b, admin: true }),
  usage: () => call<{ model: string; usage: AdminUsage[] }>('/admin/usage', { admin: true }),
  update: (id: string, patch: { active?: boolean; password?: string }) => call<{ ok: true }>(`/admin/businesses/${id}`, { method: 'PATCH', body: patch, admin: true }),
};
