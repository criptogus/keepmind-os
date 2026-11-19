export interface BridgeCliConfig {
  orgId: string;
  dataDir: string;
  port: number;
  token: string;
  apiBaseUrl: string;
}

/** Parses `--org-id --data-dir --port --token --api-base-url` argv. */
export function parseBridgeArgs(argv: string[]): BridgeCliConfig {
  const get = (name: string): string => {
    const i = argv.indexOf(`--${name}`);
    const v = i >= 0 ? argv[i + 1] : undefined;
    if (!v) throw new Error(`missing --${name}`);
    return v;
  };
  return {
    orgId: get("org-id"),
    dataDir: get("data-dir"),
    port: Number(get("port")),
    token: get("token"),
    apiBaseUrl: get("api-base-url").replace(/\/$/, ""),
  };
}
