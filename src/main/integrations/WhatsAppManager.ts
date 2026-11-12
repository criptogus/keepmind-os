import path from 'node:path';
import QRCode from 'qrcode';

export type WhatsAppStatus = 'disconnected' | 'connecting' | 'qr' | 'connected' | 'error';

export interface WhatsAppEvent {
  type: 'status' | 'qr' | 'message' | 'error';
  status?: WhatsAppStatus;
  qrDataUrl?: string;
  phone?: string;
  error?: string;
  message?: {
    id?: string;
    from: string;
    text: string;
    timestamp: number;
    isGroup?: boolean;
    chat?: string;
    chatName?: string;
    senderName?: string;
  };
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
  private transcriber: { transcribe(audio: Buffer, mimetype?: string): Promise<string | null> } | null = null;
  private groupNames = new Map<string, string>();
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

  setTranscriber(transcriber: { transcribe(audio: Buffer, mimetype?: string): Promise<string | null> } | null): void {
    this.transcriber = transcriber;
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
        void (async () => {
          for (const msg of m.messages) {
            if (msg.key.fromMe) continue;
            const jid = msg.key.remoteJid || '';
            if (jid.endsWith('@broadcast') || jid === 'status@broadcast') continue;
            const isGroup = jid.endsWith('@g.us');
            let text =
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              '';
            if (!text && msg.message?.audioMessage && this.transcriber) {
              try {
                const sock = this.sock;
                if (!sock) continue;
                const audio = await this.baileys!.downloadMediaMessage(
                  msg, 'buffer', {},
                  {
                    logger: { level: 'silent', child() { return this; } } as never,
                    reuploadRequest: sock.updateMediaMessage,
                  },
                );
                const buf = Buffer.isBuffer(audio) ? audio : Buffer.from(audio as Uint8Array);
                const transcript = await this.transcriber.transcribe(buf, msg.message.audioMessage.mimetype ?? 'audio/ogg');
                text = transcript ? `[áudio] ${transcript}` : '[mensagem de voz — transcrição indisponível]';
              } catch {
                text = '[mensagem de voz — falha ao baixar áudio]';
              }
            }
            if (!text) continue;
            const senderJid = isGroup ? (msg.key.participant || '') : jid;
            const chatName = isGroup ? await this.groupName(jid) : undefined;
            const message = {
              id: msg.key.id ?? undefined,
              from: senderJid.split('@')[0] || 'unknown',
              text: text.slice(0, 500),
              timestamp: msg.messageTimestamp
                ? Number(msg.messageTimestamp) * 1000
                : Date.now(),
              isGroup,
              chat: jid || undefined,
              chatName,
              senderName: msg.pushName || undefined,
            };
            this.emit({ type: 'message', message });
          }
        })().catch(() => {});
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

  private async groupName(jid: string): Promise<string | undefined> {
    const cached = this.groupNames.get(jid);
    if (cached) return cached;
    try {
      const meta = await this.sock?.groupMetadata(jid);
      const name = meta?.subject || jid.split('@')[0];
      this.groupNames.set(jid, name);
      return name;
    } catch {
      return jid.split('@')[0];
    }
  }

  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.sock || this.status !== 'connected') {
      throw new Error('WhatsApp is not connected');
    }
    const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
    await this.sock.sendMessage(jid, { text });
  }
}
