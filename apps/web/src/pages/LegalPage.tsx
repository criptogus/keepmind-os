import type { LegalKind } from "@keepmind/i18n/legal";
import { Logo } from "@keepmind/ui";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SupportLine } from "@/components/Standing";
import "./legal.css";

/** `/terms` or `/privacy` on a server with no page of its own for it, and where to ask. */
export function NoLegalPage({ kind }: { kind: LegalKind }) {
  const { t } = useTranslation();
  return (
    <div className="legal">
      <header className="legal__bar">
        <Link to="/" aria-label={t("legal.home")}>
          <Logo size={24} />
        </Link>
      </header>
      <main className="page page--narrow">
        <header className="legal__head">
          <h1 className="page-title">{t(`legal.none.${kind}`)}</h1>
          <p className="page-sub">
            <SupportLine />
          </p>
        </header>
      </main>
    </div>
  );
}
