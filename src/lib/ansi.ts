import AnsiToHtml from 'ansi-to-html';

/**
 * Singleton ANSI-to-HTML converter configured for a dark terminal background.
 * Produces <span style="color:..."> tags — no other HTML is generated.
 */
const converter = new AnsiToHtml({
  fg: '#94a3b8', // slate-400 — matches the default log text color
  bg: 'transparent',
  escapeXML: true, // escape <, >, & in the raw text itself
  colors: {
    // Standard 8 colors (bold variants are auto-brightened by the library)
    0: '#64748b', // black  → slate-500 (visible on dark bg)
    1: '#fb7185', // red    → rose-400
    2: '#4ade80', // green  → green-400
    3: '#facc15', // yellow → yellow-400
    4: '#60a5fa', // blue   → blue-400
    5: '#c084fc', // magenta→ purple-400
    6: '#22d3ee', // cyan   → cyan-400
    7: '#e2e8f0', // white  → slate-200
  },
});

/** Convert a string containing ANSI escape codes to safe HTML spans. */
export function ansiToHtml(text: string): string {
  return converter.toHtml(text);
}
