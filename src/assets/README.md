# Sketch theme font

`sketch-hand.woff2` is a renamed, subset copy of [CEF Fonts CJK / 快去写作业](https://github.com/Partyb0ssishere/cef-fonts-cjk)
by PartyB0ssishere. It contains the GB2312 level 1 and 2 repertoire, ASCII and
common punctuation for Canvas note-taking. The family was renamed to
`BC Sketch Hand` because OFL reserves the original name for modified versions.
The full license is in `OFL.txt`.

The font is embedded into `main.js` by `esbuild.config.mjs`; the plugin makes no
network request to load it. Rebuild the subset only from a font file whose license
and provenance have been checked.
