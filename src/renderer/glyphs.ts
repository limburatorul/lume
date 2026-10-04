/**
 * Inline icons for results that have no bitmap of their own - commands, web
 * searches, the shell, the calculator, apps whose icon could not be read.
 *
 * They are stroked with `currentColor` so a theme colours them along with the
 * text beside them, which the emoji they replaced could never do: those came
 * from the system font, ignored every theme, and sat badly next to the
 * line-drawn arrows used for the rest.
 *
 * A name that is not in here is drawn as text instead, which keeps whatever
 * character someone put on a custom search engine or command working.
 */
const PATHS: Record<string, string> = {
  app: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M4 9.5h16"/>',
  book: '<path d="M5 4.5h8.5A3.5 3.5 0 0 1 17 8v11.5H8.5A3.5 3.5 0 0 1 5 16z"/><path d="M8.5 19.5A3.5 3.5 0 0 1 12 16h7"/>',
  calc: '<path d="M6 10h12"/><path d="M6 14h12"/>',
  chat: '<path d="M20 12.5a7 7 0 0 1-7 7H5.5l2-3A7 7 0 1 1 20 12.5z"/>',
  code: '<path d="m9 8-5 4 5 4"/><path d="m15 8 5 4-5 4"/>',
  file: '<path d="M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5z"/><path d="M14 3.5V7a.5.5 0 0 0 .5.5H18"/>',
  link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.3-1.3"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  moon: '<path d="M19 14.5A8 8 0 0 1 9.5 5a8 8 0 1 0 9.5 9.5z"/>',
  package: '<path d="m12 3.5 8 4.2v8.6l-8 4.2-8-4.2V7.7z"/><path d="m4 7.7 8 4.3 8-4.3"/><path d="M12 12v8.5"/>',
  palette:
    '<path d="M12 20a8 8 0 1 1 8-8c0 2-1.6 2.6-3 2.6h-1.4a2 2 0 0 0-1.3 3.5A1.8 1.8 0 0 1 12 20z"/><circle cx="8.4" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="8.2" r="1" fill="currentColor" stroke="none"/><circle cx="15.6" cy="10.6" r="1" fill="currentColor" stroke="none"/>',
  play: '<rect x="3.5" y="5" width="17" height="14" rx="4"/><path d="m10.5 9.5 4.5 2.5-4.5 2.5z"/>',
  power: '<path d="M12 4v8"/><path d="M7.3 7.3a7 7 0 1 0 9.4 0"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5V10h-5.5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m15.8 15.8 4.2 4.2"/>',
  settings:
    '<path d="M4 7h9"/><path d="M17 7h3"/><circle cx="15" cy="7" r="2"/><path d="M4 12h3"/><path d="M11 12h9"/><circle cx="9" cy="12" r="2"/><path d="M4 17h9"/><path d="M17 17h3"/><circle cx="15" cy="17" r="2"/>',
  terminal: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="m7.5 10 2.5 2.5-2.5 2.5"/><path d="M13 15.5h4"/>',
  trash:
    '<path d="M4.5 7h15"/><path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="m6.8 7 .9 12.4A1.6 1.6 0 0 0 9.3 21h5.4a1.6 1.6 0 0 0 1.6-1.6L17.2 7"/>',
  web: '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="3.6" ry="8"/><path d="M4.3 9.5h15.4"/><path d="M4.3 14.5h15.4"/>',
}

export function glyphSvg(name: string | undefined): string | null {
  const body = name && PATHS[name]
  return body ? '<svg class="glyph-svg" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>' : null
}
