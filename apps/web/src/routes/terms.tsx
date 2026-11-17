import { createFileRoute } from "@tanstack/react-router";
import { legalPage } from "@/app/guards";
import { NoLegalPage } from "@/pages/LegalPage";

/** Terms of Use, public: an operator-configured policy's address redirects away (`legalPage`), else this notice. */
export const Route = createFileRoute("/terms")({
  loader: ({ context }) => legalPage(context, "terms"),
  component: function Terms() {
    return <NoLegalPage kind="terms" />;
  },
});
