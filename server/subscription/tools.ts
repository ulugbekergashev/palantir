/**
 * Palantir asboblari obuna dvigateli uchun: har bir asbob — MCP asbobi (Agent SDK jarayon ichida chaqiradi).
 * Tekshiruv, cheklovlar va natija API rejimidagi bilan bir xil: hammasi runTool orqali (zod kirishi, «begona matn» belgilari, xatolar)
 */
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { ownerToolDefs, runTool, type ToolCtx, type ToolGroup } from '../tools';
import { APP_VERSION } from '../version';

/** MCP asbobga maydonlar ro'yxati kerak; Palantir asboblarining kirishi doim z.object — boshqasi dasturchi xatosi */
function shapeOf(name: string, input: z.ZodType): z.ZodRawShape {
  if (!(input instanceof z.ZodObject)) throw new Error(`Asbob ${name}: kirish z.object emas — obuna dvigateli uni ulay olmaydi`);
  return input.shape;
}

/**
 * Bitta gapdagi asbob chaqiruvlari: nechtasi ishlagani (ish qilinmagan bo'lsagina qayta urinish xavfsiz — ikki marta yozilmasin) va
 * gap tugagach yopish — kechikkan chaqiruv ishlamaydi, ishlayotgani tugashi kutiladi (navbatdagi gap bilan bazada to'qnashmasin)
 */
export class ToolGate {
  private count = 0;
  private closed = false;
  private readonly running = new Set<Promise<unknown>>();

  get calls(): number { return this.count; }

  async run<T>(fn: () => Promise<T>, refused: T): Promise<T> {
    if (this.closed) return refused;
    this.count++;
    const p = fn();
    this.running.add(p);
    try {
      return await p;
    } finally {
      this.running.delete(p);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.running]);
  }
}

const LATE = { content: 'Bu gap tugagan — asbob ishlamadi', isError: true };

export function palantirTools(ctx: ToolCtx, crm: boolean, groups: ToolGroup[], gate: ToolGate): SdkMcpToolDefinition<z.ZodRawShape>[] {
  return ownerToolDefs(crm, groups).map(([name, d]) => tool(name, d.description, shapeOf(name, d.input), async args => {
    const out = await gate.run(() => runTool(name, args, ctx), LATE);
    return { content: [{ type: 'text' as const, text: out.content }], isError: out.isError };
  }));
}

export const palantirServer = (ctx: ToolCtx, crm: boolean, groups: ToolGroup[], gate: ToolGate): McpSdkServerConfigWithInstance =>
  createSdkMcpServer({ name: 'palantir', version: APP_VERSION, tools: palantirTools(ctx, crm, groups, gate) });
