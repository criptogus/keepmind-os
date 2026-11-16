export const ZERO_CONTACT = "contact@zeroagency.ai";
export const BRAIN_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "KeepMind Second Brain entry",
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "kind", "content", "visibility", "sources", "updatedAt"],
  properties: {
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    kind: { enum: ["note", "decision", "project", "person", "reference"] },
    content: { type: "string" },
    visibility: { enum: ["private", "team"] },
    sources: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" }, uniqueItems: true },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;
export type ZeroGoal = "github-brain" | "install-brain" | "cyber-team";
export function zeroGoal(kind: ZeroGoal, context: string) {
  const common =
    "Execute this complete objective using your available tools. Inspect existing configuration first; reuse resources and avoid duplicates. Preserve data, audience boundaries and permissions. Report progress, blockers, and verified results in this conversation. Never claim a resource exists without reading it back. Do not purchase, publish private data, expand access, or run security tests without the required explicit approval. ";
  if (kind === "github-brain")
    return (
      common +
      `Prepare and create my KeepMind Second Brain in GitHub. Preferred repository name: ${context || "keepmind-brain"}. Use the connected GitHub account. Check whether this private repository already exists; preserve existing files. Prepare README.md, schema/entry.schema.json, notes/, decisions/ and projects/ with examples containing no personal data. Schema: ${JSON.stringify(BRAIN_SCHEMA)}. Explain that folders in a repository do not enforce per-entry privacy: private and team memories need separate repositories/access. Ask for repository owner only if ambiguous, and present the exact private repository and file plan for approval before creating it. After approval execute, read back files and return the repository link. No automatic memory export or sync.`
    );
  if (kind === "install-brain")
    return (
      common +
      "Prepare installation of KeepMind SB using the official repository https://github.com/criptogus/keepmind and its current installation instructions. Inspect my permitted computer and reuse any existing vault. Present the installation path, dependency changes, access and connection method before requesting approval. Install only after approval, connect using the supported bridge or MCP, and verify with a non-sensitive test entry and read-back. Do not overwrite an existing vault, invent a hosted endpoint or claim installation when the computer is unavailable. Context: " +
      context
    );
  return (
    common +
    "Prepare a Cybersecurity team powered by Liquid Cybersec. Target/context: " +
    context +
    ". First inspect the connected Liquid Cybersec tools and verify the account has an active paid plan using provider evidence; a connected API key or user checkbox is not subscription proof. If billing evidence is unavailable, stop activation and explain the missing provider verification. Never buy a plan. With entitlement verified, propose a minimal team for triage, evidence-based analysis and remediation/retest coordination, reusing existing agents where appropriate. Bind only authorized Liquid tools, preserve budgets and require target ownership/scope authorization before tests or credit consumption. After the user approves the concrete team, create it, verify agents/permissions and report links. Do not initiate a scan merely by creating the team."
  );
}
