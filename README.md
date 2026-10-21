# Weapons Through Time · 兵器演进

Interactive evolution timeline of military aircraft, inspired by [war-evo.com](https://war-evo.com/).
Current scope: **US Navy carrier aircraft, 1935–1950** — 26 types on one timeline with battles,
production-scaled aircraft illustrations, service bars, lineage links and dossiers with public-domain / CC photos.

交互式军用飞机演进时间轴（参考 war-evo.com）。当前范围：**美国海军舰载机 1935–1950**，共 26 型：
战役事件带、按产量缩放的透明背景机体插画、服役条、谱系连线、详情档案（附公有领域/CC 历史照片）、中英双语。

> `APWH_Histography_V3_BILINGUAL_FINAL.html` and `Histography_Timeline_Skill_v1.0.zip` are earlier, unrelated files and are left untouched.

## Run · 运行

```bash
npm install
npm start            # http://localhost:3000
```

No server? `npm run build:static` exports the API to `public/data/*.json`; `public/` then works on any
static host (GitHub Pages etc.). The front end tries the API first and falls back to the static files.

## Layout · 目录

```
server/            Express API (JSON file store, validation, admin CRUD)
data/
  taxonomy.json    roles / basing / branches / link types
  countries.json   enabled countries (add a country = add an entry + a folder)
  conflicts.json   wars, battles, milestones
  countries/usa/   aircraft.json (26 carrier types) · lineage.json
  models/          3D model specs (legacy hangar)
public/
  index.html       carrier-aircraft timeline   ·  js/timeline.js · css/timeline.css
  img/aircraft/    <id>-art.webp timeline illustration (transparent) · <id>-900.jpg historical photo for the dossier
  legacy/          3D hangar experiment (three.js procedural models), kept for later work
  js/shared.js     date helpers shared with the server
  vendor/three/    three.js r170 (MIT)
  fonts/           Saira Stencil One · Oxanium · Share Tech Mono · ZCOOL QingKe HuangYou (OFL)
scripts/           validate.js · build-static.js
```

## API · 接口  (`/api/v1`)

| Method | Path | |
|---|---|---|
| GET | `/meta` | taxonomy + countries |
| GET | `/bundle?country=usa&from=1935&to=1950` | everything the timeline needs |
| GET | `/aircraft?role=&basing=&branch=&q=` | filtered list |
| GET | `/aircraft/:id` | record + lineage neighbours + conflicts + production rank |
| GET | `/conflicts` · `/lineage` | events, links |
| GET | `/stats/in-service` · `/stats/production` | per-year counts, ranking |
| GET | `/models` · `/models/:id` · `/hangar` | 3D model specs |
| POST/PATCH/DELETE | `/aircraft`, `/conflicts` | admin — `Authorization: Bearer $WTT_ADMIN_TOKEN` |

## Images · 图片

- **Timeline icons** — `media.cutout` → `img/aircraft/<id>-art.webp`: transparent illustrations supplied by the project
  owner (AI-generated reference renders, trimmed and compressed to 480 px WebP, ~35 KB each). They are visual
  references, not exact records of airframe geometry or markings; `media.art` carries that note and the livery reference.
- **Dossier photo** — `media.photo` → `img/aircraft/<id>-900.jpg`: historical photo from Wikimedia Commons, public
  domain first (US Navy / NARA), CC BY-SA otherwise, with author / licence / source in `media.credit`.

## Adding a 3D aircraft (legacy hangar) · 新增 3D 机型

Create `data/models/<aircraft-id>.json` (the id must exist in `aircraft.json`). All values are in metres,
`s` = distance aft of the nose, `y` = spanwise, `z` = height:

- `fuselage.stations[]` — `{ s, w (half-width), top, bot, n (superellipse exponent) }`
- `wing / hstab / fin` — `sections[] { y, le, chord, z, t (thickness ratio), twist }`, `tipRound`, `controls[]`
- `canopy.stations[]`, `frames[]`, `crew[]` · `engine` · `prop` · `details[]` (guns, exhaust, mast, hook, bomb, tip tanks, intakes, …)
- `liveries[]` — `scheme` (`solid` / `two` / `tri`), `finish`, `insignia` (era + positions), `markings[]`, `rudder`

Run `npm run validate` before committing.

## Credits

Aircraft models are original procedural geometry generated from published dimensions — no game assets are used.
three.js © three.js authors (MIT). Fonts under the SIL Open Font License.
