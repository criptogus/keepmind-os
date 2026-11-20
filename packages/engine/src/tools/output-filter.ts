/**
 * Lossy-on-purpose cleanup for tool output before it enters the transcript (the pattern
 * OmniRoute's RTK engine uses for coding agents): terminal noise is dropped and, when the
 * result still exceeds the cap, the cut keeps the head, the tail and the lines that look
 * like failures — the parts an agent acts on — instead of a blind head-only slice that loses
 * the summary and the error at the end of a log.
 *
 * Applied in the Tool Gateway (`outputOf`) to every result, so it helps both the model brain
 * (whose transcript resends each result every turn) and computer brains, whose MCP tool
 * results pass through the same gateway.
 */

/** ANSI escape sequences: colors, cursor moves, OSC titles. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
const ANSI_RE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][0-9A-B]|[=>])/g;

/**
 * Progress redraws, not content: a line opening with a spinner frame (`⠋ Building…`), or a
 * line made only of spinner frames, bars and percentages. Plain numbers, dashes and text
 * lines stay — they never match.
 */
const SPINNER_RE = /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
const PROGRESS_RE = /^[\s⠀-⣿✶✳✢·•|/\\<>%\-–—\d.,]*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✶✳✢·•|/\\<>%][\s⠀-⣿✶✳✢·•|/\\<>%\-–—\d.,]*$/;
const isProgressLine = (line: string) => line.trim() !== "" && (SPINNER_RE.test(line) || PROGRESS_RE.test(line));

/** Lines an agent acts on when a log is cut: failures, errors, warnings, panics. */
const SIGNAL_RE =
  /(?:^|\s)(?:error|err!|failed?|failure|fatal|panic|exception|traceback|assert|✗|✘|×|warn(?:ing)?|denied|refused|timeout|timed out|enoent|eacces|econnrefused|segfault|core dumped)(?:\b|:)/i;

/** Consecutive identical lines beyond this collapse to one plus a count. */
const DUP_RUN = 3;
/** Signal lines rescued from the elided middle, capped so they can't blow the budget. */
const SIGNAL_BUDGET = 4_000;
const SIGNAL_LINES = 40;

/**
 * Terminal cleanup: ANSI codes out, `\r` progress overwrites resolved to their final state,
 * spinner-only lines dropped, runs of the same line collapsed. No-ops on ordinary text.
 */
export function compressToolOutput(text: string): string {
  if (!text) return text;
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      // A carriage return redraws the line: what follows the last one is its final state.
      const final = line.includes("\r") ? line.slice(line.lastIndexOf("\r") + 1) : line;
      return final.replace(ANSI_RE, "");
    })
    .filter((line) => !isProgressLine(line));

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    let run = 1;
    while (i + run < lines.length && lines[i + run] === line && line.trim() !== "") run++;
    if (run >= DUP_RUN) {
      out.push(line, `[… ×${run - 1} more]`);
    } else {
      for (let j = 0; j < run; j++) out.push(line);
    }
    i += run - 1;
  }
  return out.join("\n");
}

/**
 * Cuts `text` to `max` chars keeping head + signal lines + tail: the beginning (what was
 * asked/started), the failures in the elided middle, and the end (the summary or the error
 * that ended the log). Strictly more useful than `cutText`'s head-only slice for logs.
 */
export function smartCutToolOutput(text: string, max: number): string {
  if (text.length <= max) return text;
  const elided = (n: number) => `\n[… ${n} chars elided …]\n`;
  const headBudget = Math.floor(max * 0.55);
  const tailBudget = Math.floor(max * 0.35);
  const head = text.slice(0, headBudget);
  const tail = text.slice(text.length - tailBudget);
  const middle = text.slice(headBudget, text.length - tailBudget);

  const signals = middle
    .split("\n")
    .filter((l) => SIGNAL_RE.test(l))
    .slice(0, SIGNAL_LINES)
    .join("\n")
    .slice(0, SIGNAL_BUDGET);

  const parts = [head, elided(middle.length)];
  if (signals) parts.push(signals, "\n");
  parts.push(tail);
  const body = parts.join("");
  // Signal lines can push past the cap: fall back to head + tail only.
  return body.length <= max ? body : `${head}${elided(middle.length)}${tail}`.slice(0, max);
}
