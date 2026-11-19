import { beginOpenRouterOAuth, finishOpenRouterOAuth } from "@keepmind/client/lib/openrouter-oauth";
import { Button, Field, Input, SettingNote } from "@keepmind/ui";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openPopup } from "@/lib/popup";

export function OpenRouterLogin({ onKey }: { onKey: (key: string) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [pending, setPending] = useState<Awaited<ReturnType<typeof beginOpenRouterOAuth>> | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const start = async () => {
    const attempt = ++generation.current;
    setBusy(true);
    setFailed(false);
    setCode("");
    setPending(null);
    try {
      const next = await beginOpenRouterOAuth();
      if (generation.current !== attempt) return;
      setPending(next);
      openPopup(next.url);
    } catch {
      if (generation.current === attempt) setFailed(true);
    } finally {
      if (generation.current === attempt) setBusy(false);
    }
  };
  const finish = async () => {
    if (!pending || busy) return;
    const attempt = generation.current;
    setBusy(true);
    setFailed(false);
    try {
      const key = await finishOpenRouterOAuth(pending, code);
      if (generation.current !== attempt) return;
      setPending(null);
      setCode("");
      onKey(key);
    } catch {
      if (generation.current === attempt) setFailed(true);
    } finally {
      if (generation.current === attempt) setBusy(false);
    }
  };
  return (
    <div className="ac-form">
      <Button variant="primary" disabled={busy} onClick={() => void start()}>
        {t("keepmind.ai.openrouter.login")}
      </Button>
      {pending && (
        <>
          <p className="small muted">{t("keepmind.ai.openrouter.instructions")}</p>
          <Button size="sm" onClick={() => openPopup(pending.url)}>
            {t("keepmind.ai.reopen")}
          </Button>
          <Field id={id} label={t("keepmind.ai.openrouter.code")}>
            <Input
              id={id}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={code}
              disabled={busy}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Button disabled={busy || !code.trim()} loading={busy} onClick={() => void finish()}>
            {t("keepmind.ai.openrouter.finish")}
          </Button>
        </>
      )}
      {failed && (
        <SettingNote icon="alert" live>
          {t("keepmind.ai.openrouter.error")}
        </SettingNote>
      )}
      <p className="small muted">{t("keepmind.ai.openrouter.cost")}</p>
    </div>
  );
}
