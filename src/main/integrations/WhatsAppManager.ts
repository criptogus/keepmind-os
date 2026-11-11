import path from 'node:path';
import QRCode from 'qrcode';

export type WhatsAppStatus = 'disconnected' | 'connecting' | 'qr' | 'connected' | 'error';

export interface WhatsAppEvent {
  type: 'status' | 'qr' | 'message' | 'error';
  status?: WhatsAppStatus;
  qrDataUrl?: string;
  phone?: string;
  error?: string;
  message?: { id?: string; from: string; text: string; timestamp: number };
}

type BaileysModule = typeof import('@whiskeysockets/baileys');
type WASocket = ReturnType<BaileysModule['default']>;

/**
 * WhatsApp connection via Baileys (unofficial WhatsApp Web multi-device client).
 * Auth credentials persist in <userData>/whatsapp-auth so QR scan is only
 * needed once. The socket runs in the main process; the renderer receives
 * status/QR/message events over IPC.
 */
export class WhatsAppManager {
  private sock: WASocket | null = null;
  private authDir: string;
  private status: WhatsAppStatus = 'disconnected';
  private phone = '';
  private shouldReconnect = true;
  private onEvent?: (event: WhatsAppEvent) => void;
  private baileys: BaileysModule | null = null;

  constructor(userDataPath: string) {
    this.authDir = path.join(userDataPath, 'whatsapp-auth');
  }

  setEventHandler(handler: (event: WhatsAppEvent) => void): void {
    this.onEvent = handler;
  }

  getStatus(): { status: WhatsAppStatus; phone: string } {
    return { status: this.status, phone: this.phone };
  }

  private emit(event: WhatsAppEvent): void {
    this.onEvent?.(event);
  }

  private setStatus(status: WhatsAppStatus, extra?: Partial<WhatsAppEvent>): void {
    this.status = status;
    this.emit({ type: 'status', status, ...extra });
  }

  private async loadBaileys(): Promise<BaileysModule> {
    if (!this.baileys) {
      this.baileys = await import('@whiskeysockets/baileys');
    }
    return this.baileys;
  }

  async start(): Promise<void> {
    if (this.sock) return;
    this.shouldReconnect = true;
    this.setStatus('connecting');

    try {
      const baileys = await this.loadBaileys();
      const { state, saveCreds } = await baileys.useMultiFileAuthState(this.authDir);
      const { version } = await baileys.fetchLatestBaileysVersion();

      this.sock = baileys.default({
        auth: state,
        version,
        browser: baileys.Browsers.ubuntu('KeepMind OS'),
        printQRInTerminal: false,
        markOnlineOnConnect: false,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
            this.setStatus('qr', { qrDataUrl });
          } catch {
            this.setStatus('qr');
          }
        }

        if (connection === 'open') {
          const jid = this.sock?.user?.id;
          this.phone = jid ? jid.split(':')[0].split('@')[0] : '';
          this.setStatus('connected', { phone: this.phone });
        }

        if (connection === 'close') {
          const statusCode =
            (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
          const loggedOut = statusCode === baileys.DisconnectReason.loggedOut;
          this.sock = null;

          if (loggedOut) {
            this.shouldReconnect = false;
            this.setStatus('disconnected');
          } else if (this.shouldReconnect) {
            this.setStatus('connecting');
            setTimeout(() => void this.start(), 2000);
          } else {
            this.setStatus('disconnected');
          }
        }
      });

      this.sock.ev.on('messages.upsert', (m) => {
        if (m.type !== 'notify') return;
        for (const msg of m.messages) {
          if (msg.key.fromMe) continue;
          const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            '';
          if (!text) continue;
          const message = {
            id: msg.key.id,
            from: msg.key.remoteJid?.split('@')[0] || 'unknown',
            text: text.slice(0, 500),
            timestamp: msg.messageTimestamp
              ? Number(msg.messageTimestamp) * 1000
              : Date.now(),
          };
          this.emit({ type: 'message', message });
        }
      });
    } catch (error) {
      this.sock = null;
      this.setStatus('error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async stop(): Promise<void> {
    this.shouldReconnect = false;
    try {
      this.sock?.end(undefined);
    } catch {
      // ignore
    }
    this.sock = null;
    this.phone = '';
    this.setStatus('disconnected');
  }

  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.sock || this.status !== 'connected') {
      throw new Error('WhatsApp is not connected');
    }
    const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
    await this.sock.sendMessage(jid, { text });
  }
}
