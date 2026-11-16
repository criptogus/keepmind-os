import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";

const app = createApp({ edition: "selfhost", version: "1", modules: [], pingDatabase: async () => {} });
const go = async (path: string, acceptLanguage?: string) => {
  const res = await app.request(path, acceptLanguage ? { headers: { "accept-language": acceptLanguage } } : {});
  return [res.status, res.headers.get("location")];
};

describe("the old help pages", () => {
  test("move for good to the docs site, in ?lang= or else the browser's language", async () => {
    expect(await go("/help/memory?lang=en")).toEqual([301, "https://keepmind.io/docs/memory"]);
    expect(await go("/help/memory?lang=pt-BR")).toEqual([301, "https://keepmind.io/pt/docs/memory"]);
    expect(await go("/help/wiki?lang=zh-Hans")).toEqual([301, "https://keepmind.io/zh/docs/wiki"]);
    expect(await go("/help/jev?lang=ko")).toEqual([301, "https://keepmind.io/ko/docs/jev"]);
    expect(await go("/help/computers", "pt-PT,pt;q=0.9")).toEqual([301, "https://keepmind.io/pt/docs/computers"]);
    // ?lang= wins over the browser; neither known reads English.
    expect(await go("/help/computers?lang=fr", "de")).toEqual([301, "https://keepmind.io/fr/docs/computers"]);
    expect(await go("/help/computers?lang=xx", "xx")).toEqual([301, "https://keepmind.io/docs/computers"]);
  });

  test("the help root and a page that doesn't exist land on the docs index", async () => {
    expect(await go("/help?lang=es")).toEqual([301, "https://keepmind.io/es/docs"]);
    expect(await go("/help/")).toEqual([301, "https://keepmind.io/docs"]);
    expect(await go("/help/nope?lang=pt-BR")).toEqual([301, "https://keepmind.io/pt/docs"]);
    expect(await go("/help/toString?lang=en")).toEqual([301, "https://keepmind.io/docs"]);
  });

  test("vary by the browser's language, so no cache hands one language's redirect to everyone", async () => {
    const res = await app.request("/help/memory", { headers: { "accept-language": "pt-BR" } });
    expect(res.headers.get("vary")).toBe("accept-language");
  });
});
