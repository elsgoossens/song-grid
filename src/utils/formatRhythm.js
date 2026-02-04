// DROP-IN: src/utils/formatRhythm.js
// Eenvoudigste/robuste aanpak: input blijft “code”, jij toont ernaast (of in PDF) de mooie versie.
// Geen cursor-gedoe, geen inline styling, geen verrassingen.

const NOTE_MAP = {
  1: "𝅝", // whole note
  2: "𝅗𝅥", // half note
  4: "♩", // quarter note
  8: "♪", // eighth note
  16: "𝅘𝅥𝅯", // sixteenth note
  32: "𝅘𝅥𝅰", // thirty-second note
};

const REST_MAP = {
  1: "𝄻", // whole rest
  2: "𝄼", // half rest
  4: "𝄽", // quarter rest
  8: "𝄾", // eighth rest
  16: "𝄿", // sixteenth rest
  // 32nd rest exists but isn't consistently supported in fonts; add later if you want.
};

function tokenizeRhythm(input) {
  // allow: spaces, commas, pipes as separators
  return String(input ?? "")
    .trim()
    .split(/[,\s|]+/g)
    .filter(Boolean);
}

function parseToken(tokenRaw) {
  let t = tokenRaw.trim();
  if (!t) return null;

  // accent/staccato support (optional, simple)
  const accent = t.includes(">");
  t = t.replace(/>/g, "");

  const stacc = t.includes("x"); // use 'x' as staccato marker
  t = t.replace(/x/g, "");

  // dotted support: any number of dots at end
  const dots = (t.match(/\.+$/)?.[0] ?? "").length;
  t = t.replace(/\.+$/g, "");

  // tie support: keep literal '-' in output as a tie marker
  // Example: "8-8" -> "♪–♪" (en-dash looks nicer than hyphen)
  if (t.includes("-")) {
    const parts = t.split("-").filter(Boolean);
    const rendered = parts.map((p) =>
      renderSingle(p, { dots: 0, accent: false, stacc: false }),
    );
    if (rendered.every(Boolean)) {
      return {
        text: rendered.join("–"),
        meta: { dots: 0, accent, stacc },
      };
    }
    // fall through if not parseable
  }

  const single = renderSingle(t, { dots, accent, stacc });
  if (!single) return null;

  // apply dots to last glyph if possible
  const dotText = dots > 0 ? "·".repeat(dots) : ""; // safer than '.' for readability
  // If you prefer classic dotted notation visual: use '.' instead of '·'
  // const dotText = dots > 0 ? ".".repeat(dots) : "";

  const prefix = accent ? ">" : "";
  const suffix = stacc ? "·" : ""; // staccato marker (simple)
  return { text: `${prefix}${single}${dotText}${suffix}` };
}

function renderSingle(t, { dots, accent, stacc }) {
  // rests: r4, r8, r16...
  const restMatch = t.match(/^r(1|2|4|8|16)$/i);
  if (restMatch) return REST_MAP[restMatch[1]] ?? null;

  // notes: 1,2,4,8,16,32
  const noteMatch = t.match(/^(1|2|4|8|16|32)$/);
  if (noteMatch) return NOTE_MAP[noteMatch[1]] ?? null;

  // fallback: if someone types a literal music symbol already, keep it
  // if (/^[♩♪𝅝𝅗𝅥𝅘𝅥𝅯𝅘𝅥𝅰𝄻𝄼𝄽𝄾𝄿]+$/.test(t)) return t;

  return null;
}

/**
 * formatRhythm
 * - input: "r4 8. 16 8-8 >4"
 * - output: "𝄽 ♪· 𝅘𝅥𝅯 ♪–♪ >♩"
 *
 * @param {string} input
 * @returns {string}
 */
export function formatRhythm(input) {
  const tokens = tokenizeRhythm(input);
  if (!tokens.length) return "";

  const out = [];
  for (const tok of tokens) {
    const parsed = parseToken(tok);
    out.push(parsed?.text ?? tok); // unknown token stays visible (no data loss)
  }
  return out.join(" ");
}
