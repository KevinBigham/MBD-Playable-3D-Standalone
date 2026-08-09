# MBD Pascal Ballpark Studio

## Boundary and data flow

Pascal is a development-time authoring application. It never replaces the MBD renderer or simulation.

```text
Pascal semantic scene
  MbdBallparkRoot
  MbdFieldReference (locked, transient, non-exported)
  MbdFenceProfile
  MbdBatterEye / MbdStandProfile / MbdScoreboard / MbdLightTower
          |
          v
ballpark-staging/<id>.json            (ignored, human-review boundary)
          |
          v
npm run ballpark:validate             (strict, fail-closed v1 validator)
          |
          v
npm run ballpark:promote -- --asset…  (explicit, single-file atomic replace)
          |
          v
src/assets/ballparks/catalog.json      (tracked canonical catalog)
       /                                      \
      v                                        v
native Stadium via ballparkAssetToStadium   renderer-only presentation registry
      |                                        |
      +---- Stadium.fence -> fenceAt() --------+
                   |                 |
                   v                 v
             Three.js wall       ball physics
```

The asset contract, validator, serializer, hash, and native adapters live in `src/ballpark/contract.ts` and are imported by both the game tools and the isolated studio. Unknown fields are rejected. The simulation adapter copies only `asset.stadium`; `presentation` is read only under `src/render`, and `authoring` is never consulted by game rules or physics.

The promoted catalog is one file. Promotion validates the complete candidate and existing catalog in memory, writes a sibling temporary file, and renames it over the catalog. An invalid candidate exits nonzero before any tracked path is opened for writing. Replacing an existing ID requires `--replace`.

## Contract and safety limits

All lengths are metres. X is left/right, Y is up, Z is home-to-centre, and spray angle is negative to left field and positive to right field.

- IDs are lowercase hyphenated slugs.
- Fence profiles contain 3–33 anchors, strictly increasing from exactly -45° to exactly +45° (1e-9° endpoint tolerance).
- Fence distance is 70–170 m; wall height is 0.6–30 m.
- Carry is 0.80–1.25; each wind component is -10–10 m/s.
- Palette colours are integers in `0x000000..0xffffff`.
- Stand scale is 0.5–2.0 and authored tiers are 1–3.
- Batter-eye, scoreboard, and light-tower angles stay inside the fair outfield arc; offsets beyond the fence are nonnegative; every dimension is finite, positive, and bounded.
- Numeric strings, `NaN`, infinities, executable fields, arbitrary URLs/meshes/shaders, unsupported versions, and unknown keys fail validation.

Canonical serialization uses explicit key order, preserves fence order, and normalizes negative zero. The stable `fnv1a64-*` content receipt excludes only `authoring.exportedAt`; it is a deterministic change detector, not a security signature.

## Install and launch

The MBD root remains a Vite + direct Three.js app with `three` as its only production dependency. The studio is a separate package and lockfile.

```bash
npm ci
npm install --prefix tools/pascal-ballpark-studio
npm run ballpark:studio
```

Open `http://127.0.0.1:5184/`. The launch command binds to loopback only.

The studio pins these exact official published packages:

| Package | Version |
|---|---:|
| `@pascal-app/core` | 0.9.2 |
| `@pascal-app/viewer` | 0.9.2 |
| `@pascal-app/editor` | 0.9.2 |
| `@pascal-app/nodes` | 0.1.1 |

The integration was checked against `pascalorg/editor` commit `27adf9a0e0b10d3206a9e24dafbdd45ff4a71dc7` and the official `pascalorg/plugin-trees` example commit `f054f889eabbba684003938d7f7142f8cd15e558`. The plugin uses public Plugin API v1. Pascal's MIT notice is preserved beside the studio.

## Authoring workflow

1. Launch the studio and import any promoted MBD park, or choose Neutral, Short-Porch, Deep-Center, High-Wall, or Dome.
2. Select **Canonical fence profile**. Drag a gold anchor in X/Z to change angle and distance; drag Y to change wall height. Interior anchors cannot cross, endpoints remain at -45°/+45°, and deleting below three anchors is blocked.
3. Use precise inspector values. Metres are editable and canonical; feet are read-only context. Carry, wind, fence distance, wall height, dome, and turf are marked gameplay-affecting.
4. Configure renderer-only stands, batter's eye, scoreboard, and towers through their semantic nodes. Undo/redo uses Pascal's temporal scene history. Valid local drafts persist in local storage.
5. Review the live field-path errors, stable hash, and gameplay-difference list.
6. Click **Export to staging**. The studio server runs the shared validator and can write only `ballpark-staging/<slug>.json`.
7. Run the impact report, review the staged JSON, then promote explicitly.

```bash
npm run ballpark:validate -- --asset ballpark-staging/anchor-yard.json
npm run ballpark:impact -- --asset ballpark-staging/anchor-yard.json --seed 12345 --samples 10000
npm run ballpark:promote -- --asset ballpark-staging/anchor-yard.json --replace
npm run ballpark:roundtrip
```

For a promoted catalog entry instead of a staged file:

```bash
npm run ballpark:impact -- --asset src/assets/ballparks/catalog.json --id anchor-yard --seed 12345 --samples 10000
```

The impact lab generates a seeded MBD contact grid, launches every ball through `src/sim/physics.stepFree` at the normal 120 Hz tick, and uses the candidate's real `fenceAt()`, carry, wind, wall collision, and home-run decisions. Its baseline is the aggregate league average across the complete promoted native catalog using identical launches.

## Showcase and fallback

Anchor Yard is the first authored showcase. Its gameplay fields and fence are semantically identical to the original park; its presentation adds a stand profile, curved batter's eye, angled scoreboard, and four custom tower placements. Sandpit and the other parks without `presentation` exercise the unchanged procedural fallback.

## Pascal upgrade procedure

1. Inspect the official tagged release, `wiki/architecture/plugin-authoring.md`, package peer ranges, and the matching `plugin-trees` commit.
2. Update exact versions only in `tools/pascal-ballpark-studio/package.json`; never use `latest`, `^`, or `*`.
3. Regenerate only the studio lockfile with `npm install --prefix tools/pascal-ballpark-studio`.
4. Repair the adapter in `src/plugin/definitions.ts`, `scene.ts`, or renderers rather than spreading Pascal changes into MBD.
5. Run `ballpark:studio:typecheck`, `ballpark:studio:test`, and `ballpark:studio:build`, then the root game gates and bundle-isolation check.

`@pascal-app/editor@0.9.2` publishes raw TypeScript. The isolated studio disables `noUnused*` because the published dependency contains unused symbols; strict type checking remains enabled. This exception does not affect MBD's root strict TypeScript configuration.

## MCP status: deliberately not enabled

The official stable `@pascal-app/mcp@0.3.2` was inspected after the core studio gates passed. It is **not compatible with external semantic nodes**:

- `SceneBridge` patch types accept core's closed `AnyNode` / `AnyNodeType` union.
- Its compiled bridge imports `AnyNode as AnyNodeSchema` from `@pascal-app/core/schema` and calls `safeParse` for create/import/validation.
- The package exports `SceneBridge`, operations, and server construction, but no `loadPlugin`, registry injection, or plugin-discovery hook.

Consequently it rejects `mbd:ballpark-root`, `mbd:fence-profile`, and the other plugin kinds before the shared MBD validator can run. Writing a custom MCP server or bypassing that schema would violate the supported-path and fail-closed requirements, so no MCP dependency, process, or config is installed.

The stable MCP CLI also requires Bun. Bun was not present in the verification environment. The normal studio uses npm/Node and does not require Bun.

When an official release exposes plugin loading in the headless bridge, the intended local-only client shape is:

```toml
# FUTURE EXAMPLE — do not enable with @pascal-app/mcp@0.3.2
[mcp_servers.mbd_pascal_ballpark]
command = "bunx"
args = ["@pascal-app/mcp@<verified-exact-version>", "--stdio"]

[mcp_servers.mbd_pascal_ballpark.env]
PASCAL_DATA_DIR = "/absolute/path/to/MBD/ballpark-staging/pascal-mcp-data"
```

Before launching that future configuration, a wrapper must check `command -v bun` and print: `Pascal MCP requires Bun for the pinned release; install Bun or leave MCP disabled. The MBD Ballpark Studio itself only requires Node.`

Example future prompts, all constrained to the local Pascal scene:

- “Make the right-field porch 6 m shorter without moving the +45° endpoint angle; keep every fence value valid and summarize gameplay changes.”
- “Add a 12 m batter's eye from -8° to +8° and place the scoreboard 14 m beyond the fence at +18°.”
- “Create a deep-centre variant from the neutral preset, validate it, and do not export or promote it.”
- “Raise only the left-field wall anchors to 10 m, then show the stable asset hash and exact changed paths.”
- “Arrange four light towers beyond the canonical fence; do not alter carry, wind, or fence geometry.”

To disable a future MCP integration, remove only its client config and delete its ignored `ballpark-staging/pascal-mcp-data` directory. The studio, validator, impact lab, and native game remain independent.

## Rollback and removal

- Roll back a promotion by restoring the prior `src/assets/ballparks/catalog.json`; no generated registry file needs separate repair.
- Remove a staged draft by deleting its ignored `ballpark-staging/<id>.json`; promoted game data is unaffected.
- Remove Pascal tooling by deleting `tools/pascal-ballpark-studio` and the four `ballpark:studio*` package scripts. The runtime catalog, native adapters, renderer, and physics remain functional and contain no Pascal import.
