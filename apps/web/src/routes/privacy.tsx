import { createFileRoute } from "@tanstack/react-router";
import { legalPage } from "@/app/guards";
import { NoLegalPage } from "@/pages/LegalPage";

/** Privacy Policy, public: an operator-configured policy's address redirects away (`legalPage`), else this notice. */
export const Route = createFileRoute("/privacy")({
  loader: ({ context }) => legalPage(context, "privacy"),
  component: function Privacy() {
    return <NoLegalPage kind="privacy" />;
  },
});
