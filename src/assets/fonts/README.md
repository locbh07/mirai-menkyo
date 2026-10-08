# Japanese Knowledge Font

`knowledge-jp-a0f24ec24c83.woff` is a variable-weight subset derived from
[Noto Sans JP](https://github.com/notofonts/noto-cjk/blob/main/Sans/README.md),
using the upstream `Sans/Variable/TTF/Subset/NotoSansJP-VF.ttf` resource.

It was converted to WOFF and subset using FontTools 4.63.0 to the characters in
`data/knowledge-ja/lessons.json`, the reader/interface strings, ASCII and kana.
All layout features and source copyright/license name records were retained.
The modified font family is renamed to `Mirai Knowledge JP`. Its license remains
SIL Open Font License 1.1; see `NotoSansJP-LICENSE.txt` and the embedded font notices.

The local font avoids a third-party font request and covers this imported manual.
If future Japanese content adds characters, regenerate the subset or use the
declared native Japanese font fallbacks. Do not assume this subset is a complete
Japanese font for unrelated material.
