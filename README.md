# Weapons Through Time · 兵器演进

Interactive evolution timeline of military aircraft, inspired by [war-evo.com](https://war-evo.com/).
Current scope: **US Navy carrier aircraft, 1935–1950**. This commit ships the **3D hangar demo** —
three aircraft (F4U-4 Corsair, SBD-3 Dauntless, F9F-2 Panther) built as procedural 3D models
in the War Thunder-style 3/4 overhead view, with switchable historical liveries.

交互式军用飞机演进时间轴（参考 war-evo.com）。当前范围：**美国海军舰载机 1935–1950**。
本次提交为 **3D 机库演示**：F4U-4“海盗”、SBD-3“无畏”、F9F-2“黑豹”三架程序化 3D 模型，
45° 半俯视角，可切换历史涂装、360° 检视、发动机运转、蓝图模式。

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
  models/          3D model specs — one JSON per aircraft (geometry in metres + liveries)
public/
  index.html       3D hangar demo
  js/air3d/engine.js   procedural 3D engine (three.js): lofted fuselage, NACA wings, canopy,
                       prop, radial engine, canvas-painted liveries, WT-style thumbnails, viewer
  js/hangar.js     hangar page logic · js/shared.js date helpers (shared with the server)
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

## Adding a 3D aircraft · 新增 3D 机型

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
