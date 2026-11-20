import { createFileRoute } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { GoalsPage } from "@/pages/GoalsPage";

/** Goals (OKRs): the workspace's measurable targets — what agents propose and people activate and track. */
export const Route = createFileRoute("/org/$orgId/goals")({
  component: () => (
    <Main>
      <GoalsPage />
    </Main>
  ),
});
