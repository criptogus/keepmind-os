import type { ApiClient } from "@keepmind/client";
import { fileSaver } from "@/components/artifacts/fileSaver";

/** Downloads the workspace as a file: its agents, skills, routines and shared memory, never conversations or files. */
export const saveExport = (api: ApiClient, orgId: string) =>
  fileSaver.save(api.imports.exportUrl(orgId), `keepmind-os-${new Date().toISOString().slice(0, 10)}.json`);
