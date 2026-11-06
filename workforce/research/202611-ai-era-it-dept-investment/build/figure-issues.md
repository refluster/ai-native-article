# Figure DATA issues for the editor (S10 prep)

Written by yusuf and aoi. Every one of the 30 FIG blocks renders as currently written: the build reports 0 render errors, and no figure is empty or clipped in light, dark or 390px screenshots. figures.mjs absorbs every shape the editor used. The items below are DATA changes that would make a figure more accurate. Nothing here blocks the build. Apply them in report.md. No renderer change is needed for any of them.

## Changes requested

| FIG | What is wrong | Exact JSON change |
|---|---|---|
| 7-3 | `segments` sum to 92.6%, not 100%. The renderer leaves the last 7.4% of the bar empty and says so in the note, but the reader is not told what is missing. The single bar also has no row label, so the renderer falls back to "全体", although the caption says 日本. | Add `"row_label":"日本"`. Then either add the missing segment (e.g. `["無回答・わからない",7.4]`, using the white paper's real category name) or extend `not` to say what the 7.4% is. |
| 5-2 | `effects[].y` says "受容確率 −30% / −10%". Ancker et al. 2017 reports these as changes in the **odds** of acceptance (odds ratios), not in the probability. The figure draws "基準 = 100 → 70", which reads as probability. | Check against S-7.3. If they are odds, change to `"y":"受容オッズ −30%"` and `"y":"受容オッズ −10%"`. The panels will then read "受容オッズ (基準 = 100 の相対値)". |
| 4-2 | `jp_guideline_versions` has dates only, so the timeline labels them generically: "AI事業者GL 公表" for the first and "改訂" for the rest. | Give each date its version label, e.g. `"jp_guideline_versions":[["2024-04-19","第1.0版"],["2024-11-22","第1.01版"],["2025-03-28","第1.1版"],["2026-03-31","第1.2版"]]`. Check the version numbers against S-6.13; the renderer already accepts `[date, label]` pairs. |
| 1-1 | `not` reads "本版v1はS6時点で、S7以降のゲートは未通過". This will be stale by the time S10/S11 ships. | Update to the actual gate state at publication, e.g. `"not":"本版はS10時点。S11 (納品・振り返り) のゲートは未通過"`. |
| 1-3 | The tiles count 135 sources in the register (87+30+16+2). The executive summary says "一次・準一次資料 133 件". These may measure different things (all vs primary + semi-primary = 117), but the reader cannot tell. | Either align the summary text, or add a tile/`not` that defines what 133 counts. |

## Optional (renders correctly today; cleaner if changed)

| FIG | Note | Suggested JSON |
|---|---|---|
| 6-2 | Typed `bar`, but the three items have three different units (%, ラウンド, トークン) and one string value. The renderer detects the mixed units and draws small-multiple panels, not one bar chart (which would be wrong). | Change the type to `small-multiples-bar` and rename `items` to `panels`. Same objects, no other change. |
| 0-2 | Typed `heatmap-table`. Rows carry `verdict`/`conf`, so it renders with the 判定×確度 verdict heatmap (same chips as the 判定表), not the numeric `matrix`. | None needed. If you want the generic matrix instead, supply `cols` and numeric `cells`. |
| 1-2 | Leaves are H-ids only. Labels, verdicts and confidence are looked up at build time from the 判定表 rows in report.md (`\| H-x.y \| claim \| verdict \| conf \|`). If that table's columns are reordered, leaves turn grey (未検証). | Keep the 判定表 column order (ID, 主張, 判定, 確度, …). |
| 8-1 | Only one workstream per quarter, so the figure shows the lanes 作業 / ゲート / 判定者. | To show several workstreams, give each quarter an optional `"lane": 0..5` index (colours the work card). |
| 3-3, 8-2, 8-3, 10-1 | `{"table":"following-markdown"}`: the build now moves the markdown table that directly follows the block into the figure. | Keep exactly one blank line between `-->` and the table. |

## Type → renderer map (for reference)

stat-tiles/tiles → statTiles · bar/hbars → hbars (falls back to small multiples for mixed units) · contrast-bar → hbars + "1倍 = 差なし" reference · grouped-bar(s) → groupedBars · stacked-bar-horizontal/stacked-hbar → stackedHbar (+ `reference` marker) · small-multiples-bar → smallMultiples · dumbbell · dual-line → side-by-side line panels (each with its own x axis; one shared chart only when the x values match) · dose-response-line → relative-change line panels · timeline (lanes; superseded dates drawn as hollow markers with an arrow to the new date) · matrix (row-kind levels) · heatmap-table → verdicts or matrix · table (array, object or following-markdown rows) · roadmap → stage cards when `stages[].title` is absent · gated-roadmap · process · two-layer · mapping · principle-diagram/experiment-design → diagram (banded rows, wrapped labels) · tree · verdicts.
