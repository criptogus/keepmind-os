import { useReaConnect, useReaDisconnect, useReaStatus } from "@keepmind/client";
import { Button, Card, CardHeader, Chip } from "@keepmind/ui";
import { useTranslation } from "react-i18next";
import { ConnectorIcon } from "@/components/ConnectorCatalog";

/**
 * The REA connector (reverse engineering sidecar): one card on Connectors
 * with the sidecar's status and connect/disconnect. Admins drive it; the
 * sidecar reads host files, so the card says so plainly.
 */
export function ReaConnect({ orgId, admin }: { orgId: string; admin: boolean }) {
  const { t } = useTranslation();
  const status = useReaStatus(orgId, admin);
  const connect = useReaConnect(orgId);
  const disconnect = useReaDisconnect(orgId);
  const s = status.data?.rea ?? null;
  const running = s?.status === "running";

  const chip = running ? (
    <Chip icon="check" tone="done">
      {t("connectors.rea.running")}
    </Chip>
  ) : s?.lastError ? (
    <Chip icon="alert" tone="waiting">
      {t("connectors.rea.error")}
    </Chip>
  ) : null;

  return (
    <Card aria-labelledby="sec-rea">
      <CardHeader
        id="sec-rea"
        title={
          <span className="ac-whatsapp-title">
            <ConnectorIcon def={{ iconUrl: "/connectors/rea.svg", brandColor: "#7C3AED" }} label="REA" size="md" />
            {t("connectors.rea.title")}
          </span>
        }
        hint={{ name: t("connectors.rea.title"), text: t("connectors.rea.hint") }}
        action={chip}
      />
      <div className="ac-whatsapp">
        <p className="small muted">{t("connectors.rea.description")}</p>
        {s?.lastError && <p className="small muted">{s.lastError}</p>}
        {admin && (
          <div className="ac-whatsapp__actions">
            {!running && (
              <Button size="sm" variant="primary" loading={connect.isPending} onClick={() => connect.mutate()}>
                {t("connectors.rea.connect")}
              </Button>
            )}
            {running && (
              <Button size="sm" variant="ghost" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                {t("connectors.rea.disconnect")}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
