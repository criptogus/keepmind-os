import type { Agent } from "@keepmind/client";
import {
  useWhatsAppAnswerAgent,
  useWhatsAppConnect,
  useWhatsAppDisconnect,
  useWhatsAppSession,
} from "@keepmind/client";
import { Button, Card, CardHeader, Chip, Field, QrCode, Select } from "@keepmind/ui";
import { useTranslation } from "react-i18next";
import { ConnectorIcon } from "@/components/ConnectorCatalog";

/**
 * The WhatsApp connector (QR pairing, unofficial session bridge): one card on
 * Connectors with the live QR while pairing, the connected number, disconnect,
 * and which agent answers inbound chats. Admins drive it; everyone sees status.
 */
export function WhatsAppConnect({ orgId, admin, agents }: { orgId: string; admin: boolean; agents: Agent[] }) {
  const { t } = useTranslation();
  const session = useWhatsAppSession(orgId);
  const connect = useWhatsAppConnect(orgId);
  const disconnect = useWhatsAppDisconnect(orgId);
  const answer = useWhatsAppAnswerAgent(orgId);
  const s = session.data?.session ?? null;
  const status = s?.status ?? "off";

  const chip =
    status === "connected" ? (
      <Chip icon="check" tone="done">
        {t("connectors.whatsapp.connected")}
      </Chip>
    ) : status === "pairing" ? (
      <Chip icon="waiting" tone="waiting">
        {t("connectors.whatsapp.pairing")}
      </Chip>
    ) : status === "needs_reconnect" ? (
      <Chip icon="alert" tone="waiting">
        {t("connectors.whatsapp.needsReconnect")}
      </Chip>
    ) : null;

  return (
    <Card aria-labelledby="sec-whatsapp">
      <CardHeader
        id="sec-whatsapp"
        title={
          <span className="ac-whatsapp-title">
            <ConnectorIcon
              def={{ iconUrl: "/connectors/whatsapp.svg", brandColor: "#25D366" }}
              label="WhatsApp"
              size="md"
            />
            WhatsApp
          </span>
        }
        hint={{
          name: t("connectors.whatsapp.title"),
          text: t("connectors.whatsapp.hint"),
        }}
        action={chip}
      />
      <div className="ac-whatsapp">
        {status === "pairing" && (
          <div className="ac-whatsapp__pair">
            {s?.qr ? (
              <QrCode text={s.qr} label={t("connectors.whatsapp.qrLabel")} />
            ) : (
              <p className="small muted">{t("connectors.whatsapp.qrPending")}</p>
            )}
            <p className="small muted">{t("connectors.whatsapp.scanHint")}</p>
          </div>
        )}
        {status === "connected" && (
          <p className="small">
            {s?.phone ? t("connectors.whatsapp.connectedAs", { phone: s.phone }) : t("connectors.whatsapp.connected")}
          </p>
        )}
        {status === "needs_reconnect" && s?.lastError && <p className="small muted">{s.lastError}</p>}
        {status === "off" && <p className="small muted">{t("connectors.whatsapp.description")}</p>}
        {admin && (
          <div className="ac-whatsapp__actions">
            {(status === "off" || status === "needs_reconnect") && (
              <Button size="sm" variant="primary" loading={connect.isPending} onClick={() => connect.mutate()}>
                {status === "needs_reconnect" ? t("connectors.whatsapp.reconnect") : t("connectors.whatsapp.connect")}
              </Button>
            )}
            {(status === "connected" || status === "pairing") && (
              <Button size="sm" variant="ghost" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                {t("connectors.whatsapp.disconnect")}
              </Button>
            )}
          </div>
        )}
        {status === "connected" && admin && (
          <Field
            label={t("connectors.whatsapp.answerAgent")}
            hint={{ name: t("connectors.whatsapp.answerAgent"), text: t("connectors.whatsapp.answerAgentHint") }}
          >
            <Select
              size="sm"
              value={s?.answerAgentId ?? ""}
              onValueChange={(v) => answer.mutate(v === "" ? null : v)}
              options={[
                { value: "", label: t("connectors.whatsapp.answerRightHand") },
                ...agents.filter((a) => !a.former).map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          </Field>
        )}
      </div>
    </Card>
  );
}
