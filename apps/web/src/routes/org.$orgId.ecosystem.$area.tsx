import { createFileRoute } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { ZeroAgencyPage } from "@/pages/ZeroAgencyPage";
export const Route = createFileRoute("/org/$orgId/ecosystem/$area")({
  component: function Page() {
    const { area } = Route.useParams();
    return (
      <Main>
        <ZeroAgencyPage area={area} />
      </Main>
    );
  },
});
