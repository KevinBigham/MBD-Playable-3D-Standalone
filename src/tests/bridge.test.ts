import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameSetup } from '../core/types';
import { createGameState } from '../sim/state';
import { stepGame } from '../sim/game';
import { emptyInputPair, clearEdges } from '../sim/input';
import { finishGame } from '../sim/result';
import { STADIUMS, STADIUM_BY_ID } from '../data/stadiums';
import { TEAM_IDENTITIES, homeStadiumOf, nextTeamId, shiftTeam } from '../data/teams';
import {
  MBD_INTERNAL_MAX,
  MOONSHOT_ATTR_MAX,
  MOONSHOT_ATTR_MIN,
  blendAttribute,
  makeRating,
  personalityToAttribute,
  ratingIsSelfConsistent,
  toAttribute,
} from '../bridge/rating';
import { validateBundle } from '../bridge/validate';
import { adaptWorld, parkForFactor } from '../bridge/adapt';
import { buildFixtureBundle } from '../bridge/fixture';
import { buildReceipt, reconcileReceipt } from '../bridge/receipt';
import { MBD_FRANCHISES } from '../bridge/franchises';
import type { MbdArcadeWorldBundleV1 } from '../bridge/contract';

/**
 * THE MBD BRIDGE
 * ==============
 * MOONSHOT NINE is the arcade consumer in the MBD arcade-world contract: it
 * receives a world, plays one game inside it, and hands back a receipt. The
 * contract's own safety rules are what this file tests, because every one of
 * them describes a way for two games to quietly disagree about the same
 * dynasty — which is worse than either of them being broken, since neither ever
 * reports an error.
 *
 * The rules that get their own tests here:
 *
 *   - ratings convert once, from `internal`, and monotonically;
 *   - a mismatched package is rejected rather than repaired;
 *   - IDs are the joins — nothing is ever matched by name;
 *   - a modifier is applied once, and what was applied is recorded;
 *   - an exhibition package produces no importable receipt at all;
 *   - a receipt reconciles against its own package before it leaves.
 */

// ---------------------------------------------------------------- conversions

describe('ratings cross the bridge once', () => {
  it('reproduces the exporter’s published conversion exactly', () => {
    // Straight from the contract:
    //   normalized = clamped / 550
    //   display    = round(20 + normalized * 60)
    //   arcade99   = round(normalized * 99)
    for (const internal of [0, 1, 137, 275, 400, 549, 550]) {
      const r = makeRating(internal);
      const n = internal / 550;
      expect(r.internal).toBe(internal);
      expect(r.normalized).toBeCloseTo(n, 12);
      expect(r.display).toBe(Math.round(20 + n * 60));
      expect(r.arcade99).toBe(Math.round(n * 99));
    }
    expect(makeRating(0).display).toBe(20);
    expect(makeRating(550).display).toBe(80);
  });

  it('clamps out-of-range source values instead of trusting them', () => {
    expect(makeRating(-40).internal).toBe(0);
    expect(makeRating(9999).internal).toBe(MBD_INTERNAL_MAX);
  });

  it('spans this game’s attribute range end to end', () => {
    expect(toAttribute(makeRating(0))).toBe(MOONSHOT_ATTR_MIN);
    expect(toAttribute(makeRating(MBD_INTERNAL_MAX))).toBe(MOONSHOT_ATTR_MAX);
  });

  it('never makes a better player worse — every rating, every value', () => {
    // The contract permits a receiver to tune its curves and forbids it to
    // reorder two players: "a higher source rating cannot secretly make the
    // corresponding skill worse". A sweep is the only honest way to assert
    // that, because a monotonicity bug from a rounding or blending mistake
    // shows up at two adjacent values and nowhere else.
    let last = -1;
    for (let internal = 0; internal <= MBD_INTERNAL_MAX; internal++) {
      const v = toAttribute(makeRating(internal));
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(last).toBe(MOONSHOT_ATTR_MAX);
  });

  it('stays monotone in every input when two ratings are blended', () => {
    // The pitcher's movement is a blend of MBD movement and stuff. A blend is
    // where monotonicity is easiest to lose by accident, so it is swept in both
    // variables independently.
    const at = (mv: number, st: number) =>
      blendAttribute([
        { rating: makeRating(mv), weight: 3 },
        { rating: makeRating(st), weight: 1 },
      ]);
    for (const fixed of [0, 200, 400, 550]) {
      let lastByMove = -1;
      let lastByStuff = -1;
      for (let v = 0; v <= MBD_INTERNAL_MAX; v += 5) {
        const byMove = at(v, fixed);
        const byStuff = at(fixed, v);
        expect(byMove).toBeGreaterThanOrEqual(lastByMove);
        expect(byStuff).toBeGreaterThanOrEqual(lastByStuff);
        lastByMove = byMove;
        lastByStuff = byStuff;
      }
    }
  });

  it('reads only `internal`, so a corrupt convenience field changes nothing', () => {
    // `arcade99` sits temptingly close to this game's own scale. Using it would
    // throw away resolution MBD paid for — and would make a bundle with stale
    // derived fields silently play differently.
    const honest = makeRating(430);
    const lying = { ...honest, display: 20, arcade99: 0, normalized: 0 };
    expect(toAttribute(lying)).toBe(toAttribute(honest));
    // ...but the drift is still detectable, which is what the warning is for.
    expect(ratingIsSelfConsistent(honest)).toBe(true);
    expect(ratingIsSelfConsistent(lying)).toBe(false);
  });

  it('maps personality on its own 0..100 scale', () => {
    expect(personalityToAttribute(0)).toBe(MOONSHOT_ATTR_MIN);
    expect(personalityToAttribute(100)).toBe(MOONSHOT_ATTR_MAX);
    expect(personalityToAttribute(-5)).toBe(MOONSHOT_ATTR_MIN);
  });
});

// ------------------------------------------------------------------ park factor

describe('a park factor picks a ballpark', () => {
  it('resolves to the nearest park by carry, not to a multiplier', () => {
    // The decision the handoff asks to be made explicitly. MBD's factor becomes
    // the choice of stadium — geometry a hitter can see — rather than a
    // coefficient stacked on top of a park this game already simulates in full.
    const carryOf = (id: string) => STADIUMS.find((s) => s.id === id)!.carry;
    for (const f of MBD_FRANCHISES) {
      const park = carryOf(parkForFactor(f.parkFactor));
      const best = Math.min(...STADIUMS.map((s) => Math.abs(s.carry - f.parkFactor)));
      expect(Math.abs(park - f.parkFactor)).toBeCloseTo(best, 12);
    }
  });

  it('sends the thinnest air to the biggest park and vice versa', () => {
    // Denver is MBD's most homer-friendly park at 1.12; San Francisco its least
    // at 0.95. If those two ever came out the same way round, the mapping would
    // be numerically defensible and obviously wrong.
    const denver = parkForFactor(1.12);
    const bay = parkForFactor(0.95);
    const carry = (id: string) => STADIUMS.find((s) => s.id === id)!.carry;
    expect(carry(denver)).toBeGreaterThan(carry(bay));
    expect(carry(denver)).toBe(Math.max(...STADIUMS.map((s) => s.carry)));
  });
});

// ------------------------------------------------------------------ validation

/** A deep copy, so a negative test cannot leak into the next one. */
function mutate(fn: (b: MbdArcadeWorldBundleV1) => void): MbdArcadeWorldBundleV1 {
  const b = JSON.parse(JSON.stringify(buildFixtureBundle({ teams: 4 }))) as MbdArcadeWorldBundleV1;
  fn(b);
  return b;
}

describe('a package is rejected rather than repaired', () => {
  it('accepts a conforming bundle', () => {
    const check = validateBundle(buildFixtureBundle({ teams: 4 }));
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('refuses anything that is not a v1 arcade world', () => {
    expect(validateBundle(null).ok).toBe(false);
    expect(validateBundle({ format: 'something-else' }).ok).toBe(false);
    const v2 = mutate((b) => {
      (b as unknown as { bridgeVersion: number }).bridgeVersion = 2;
    });
    const check = validateBundle(v2);
    expect(check.ok).toBe(false);
    expect(check.problems[0].rule).toBe('bridgeVersion');
  });

  it('refuses a dynasty package that does not name its save', () => {
    const b = buildFixtureBundle({ mode: 'dynasty_scheduled_game', teams: 4 });
    b.source.saveId = null;
    expect(validateBundle(b).ok).toBe(false);
  });

  it('refuses two players who share an id, because ids are the joins', () => {
    const b = mutate((x) => {
      x.players[1].id = x.players[0].id;
    });
    const check = validateBundle(b);
    expect(check.ok).toBe(false);
    expect(check.problems[0].rule).toBe('player.id');
  });

  it('refuses a roster that claims somebody else’s player', () => {
    const b = mutate((x) => {
      // A cross-checked membership failure: the roster says this player is ours,
      // the player record says otherwise. Repairing it would invent a trade.
      x.organizations[0].active26PlayerIds.push(
        x.players.find((p) => p.teamId !== x.organizations[0].teamId)!.id,
      );
    });
    const check = validateBundle(b);
    expect(check.ok).toBe(false);
    expect(check.problems[0].rule).toBe('org.member');
  });

  it('refuses a lineup that is not nine, or that bats somebody twice', () => {
    const short = mutate((x) => {
      x.organizations[0].defaults.lineupPlayerIds.pop();
    });
    expect(validateBundle(short).problems[0].rule).toBe('org.lineup');

    const twice = mutate((x) => {
      const l = x.organizations[0].defaults.lineupPlayerIds;
      l[8] = l[0];
    });
    expect(validateBundle(twice).problems[0].rule).toBe('org.lineup');
  });

  it('refuses to bat somebody MBD says is unavailable', () => {
    const b = mutate((x) => {
      const id = x.organizations[0].defaults.lineupPlayerIds[3];
      const p = x.players.find((q) => q.id === id)!;
      p.availability.eligible = false;
      p.availability.reason = 'injured';
    });
    const check = validateBundle(b);
    expect(check.ok).toBe(false);
    expect(check.problems[0].rule).toBe('org.lineup');
  });

  it('refuses a starting pitcher who cannot pitch', () => {
    const b = buildFixtureBundle({ mode: 'dynasty_scheduled_game', teams: 4 });
    const bat = b.players.find((p) => !p.canPitch && p.teamId === b.game!.home.teamId)!;
    b.game!.home.startingPitcherId = bat.id;
    const check = validateBundle(b);
    expect(check.ok).toBe(false);
    expect(check.problems[0].rule).toBe('game.starter');
  });

  it('refuses a game that plays an unavailable player', () => {
    const b = buildFixtureBundle({ mode: 'dynasty_scheduled_game', teams: 4 });
    b.game!.away.unavailablePlayerIds = [b.game!.away.lineupPlayerIds[2]];
    expect(validateBundle(b).problems[0].rule).toBe('game.eligibility');
  });

  it('refuses a duplicated modifier, because it could not be applied once', () => {
    const b = buildFixtureBundle({ mode: 'dynasty_scheduled_game', teams: 4 });
    const m = { id: 'x', side: 'both' as const, kind: 'test', value: 1, source: 'test' };
    b.game!.explicitModifiers = [m, { ...m }];
    expect(validateBundle(b).problems[0].rule).toBe('game.modifiers');
  });

  it('warns about derived-field drift without refusing to play', () => {
    const b = mutate((x) => {
      x.players[0].hitter.power.arcade99 = 3;
    });
    const check = validateBundle(b);
    expect(check.ok).toBe(true);
    expect(check.warnings.some((w) => w.rule === 'rating.derived')).toBe(true);
  });
});

// -------------------------------------------------------------------- adapting

describe('a dynasty becomes nine people on a field', () => {
  const bundle = buildFixtureBundle();
  const world = adaptWorld(bundle);

  it('brings every franchise across with its own identity', () => {
    expect(world.teams).toHaveLength(MBD_FRANCHISES.length);
    const denver = world.teams.find((t) => t.id === 'den')!;
    expect(denver.city).toBe('Denver');
    expect(denver.name).toBe('Altitude');
    expect(denver.abbr).toBe('DEN');
    // #3b1c75 as an integer, not re-derived from a name or an index.
    expect(denver.primary).toBe(0x3b1c75);
    expect(denver.homeStadium).toBe(parkForFactor(1.12));
  });

  it('keeps MBD ids as ids, so nothing is ever matched by name', () => {
    const src = new Set(bundle.players.map((p) => p.id));
    for (const t of world.teams) {
      for (const p of t.players) expect(src.has(p.id)).toBe(true);
    }
  });

  it('gives every club a legal, playable roster', () => {
    for (const t of world.teams) {
      expect(t.lineup).toHaveLength(9);
      expect(new Set(t.lineup).size).toBe(9);
      expect(t.defense).toHaveLength(9);
      expect(t.rotation.length).toBeGreaterThan(0);
      const ids = new Set(t.players.map((p) => p.id));
      for (const id of [...t.lineup, ...t.defense, ...t.rotation, ...t.bullpen]) {
        expect(ids.has(id)).toBe(true);
      }
      // Whoever is on the mound must actually be a pitcher.
      const starter = t.players.find((p) => p.id === t.rotation[0])!;
      expect(starter.pitch).toBeTruthy();
    }
  });

  it('uses the exported lineup rather than inventing its own', () => {
    // The batting order is MBD's decision, or the user's inside MBD. Re-deriving
    // it here would be the arcade game overruling the world authority about its
    // own roster.
    const org = bundle.organizations.find((o) => o.teamId === 'bos')!;
    const team = world.teams.find((t) => t.id === 'bos')!;
    expect(team.lineup).toEqual(org.defaults.lineupPlayerIds);
  });

  it('preserves the source ordering of talent', () => {
    // Not "the numbers are right" — that is the conversion test — but "the best
    // hitter in MBD is still the best hitter here", which is what a player would
    // actually notice.
    const byPower = [...bundle.players]
      .filter((p) => p.teamId === 'nym')
      .sort((a, b) => b.hitter.power.internal - a.hitter.power.internal);
    const team = world.teams.find((t) => t.id === 'nym')!;
    const at = (id: string) => team.players.find((p) => p.id === id)!.bat.power;
    for (let i = 1; i < byPower.length; i++) {
      expect(at(byPower[i - 1].id)).toBeGreaterThanOrEqual(at(byPower[i].id));
    }
  });

  it('leaves unavailable players out and says how many', () => {
    const injured = JSON.parse(JSON.stringify(bundle)) as MbdArcadeWorldBundleV1;
    const victim = injured.players.find(
      (p) => !injured.organizations.some((o) => o.defaults.lineupPlayerIds.includes(p.id)),
    )!;
    victim.availability.eligible = false;
    victim.availability.reason = 'injured';
    const after = adaptWorld(injured);
    const club = after.teams.find((t) => t.id === victim.teamId)!;
    expect(club.players.some((p) => p.id === victim.id)).toBe(false);
    expect(after.report.notes.join(' ')).toContain('unavailable');
  });

  it('writes down every fact it invented', () => {
    // The contract's phrase is "never writes those defaults back as MBD truth".
    // The mechanism is that they are listed here and have nowhere else to go.
    const derived = world.report.derived.join(' ');
    expect(derived).toContain('handedness');
    expect(derived).toContain('ballpark');
    expect(world.report.ignored.join(' ')).toContain('durability');
    // One park decision recorded per club: applied once, and provably once.
    expect(world.report.applied.filter((a) => a.startsWith('park:'))).toHaveLength(
      world.teams.length,
    );
  });

  it('is deterministic, so two devices import the same people', () => {
    const again = adaptWorld(buildFixtureBundle());
    expect(JSON.stringify(again.teams)).toBe(JSON.stringify(world.teams));
  });
});

// ------------------------------------------------------ the world we ship

/**
 * THE ONE THAT ACTUALLY REACHES A PLAYER.
 *
 * `public/mbd-world.json` is MBD's opening day, produced by running MBD's own
 * `generateLeaguePlayers` over a checkout (see `scripts/export-mbd-world.ts`).
 * It is the league a fresh install opens in, so it is the one file here whose
 * failure a person would actually meet — and it is generated by a script that
 * runs against a repository this one does not contain, which means nothing else
 * in CI would notice if it went stale or wrong.
 *
 * So it is validated as data, exactly as an imported bundle would be.
 */
describe('the MBD world that ships with the game', () => {
  const raw = readFileSync('public/mbd-world.json', 'utf8');
  const bundle = JSON.parse(raw) as MbdArcadeWorldBundleV1;

  it('passes the same validation an imported bundle would', () => {
    const check = validateBundle(bundle);
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('is MBD\u2019s full league, not a subset', () => {
    expect(bundle.teams).toHaveLength(MBD_FRANCHISES.length);
    const shipped = new Set(bundle.teams.map((t) => t.id));
    for (const f of MBD_FRANCHISES) expect(shipped.has(f.id)).toBe(true);
  });

  it('carries MBD\u2019s own players, with MBD\u2019s own ratings', () => {
    // The canary is a real person out of MBD's generator: the ace of its
    // deliberately overpowered Kansas City franchise. A fixture cannot produce
    // him, so his presence is the difference between "thirty-two clubs" and
    // "MBD's thirty-two clubs".
    const kc = bundle.players.filter((p) => p.teamId === 'kc');
    const ace = kc.find((p) => p.displayName === 'Marcus Fontaine');
    expect(ace).toBeTruthy();
    expect(ace!.canPitch).toBe(true);
    expect(ace!.pitcher!.stuff.internal).toBeGreaterThan(450);
    // And the ratings are on MBD's canonical scale, self-consistent.
    for (const p of bundle.players.slice(0, 200)) {
      for (const r of Object.values(p.hitter)) expect(ratingIsSelfConsistent(r)).toBe(true);
    }
  });

  it('never exports the scouting truth the contract forbids', () => {
    // Ceiling, floor, potential, development program and trajectory are hidden
    // future truth. MBD attaches them in a step the exporter deliberately does
    // not run, so the proof is that no player object carries the field at all.
    const forbidden = ['ceiling', 'floor', 'potentialRating', 'developmentProgram', 'developmentTrajectory', 'contract', 'serviceTimeDays'];
    for (const p of bundle.players) {
      for (const key of forbidden) {
        expect(Object.prototype.hasOwnProperty.call(p, key)).toBe(false);
      }
    }
  });

  it('never fields somebody who does not bat', () => {
    // Real MBD lineups are the nine best hitters by overall, which is often not
    // one of each position — Kansas City opens with two catchers, two left
    // fielders, two first basemen and no second baseman. Assigning the field by
    // looking for a natural at each slot pulls two men off the bench who then
    // field without ever batting, which is not baseball, and which every
    // fixture-based test missed because a templated lineup has no gaps.
    const world = adaptWorld(bundle);
    for (const t of world.teams) {
      const batting = new Set(t.lineup);
      const fielders = t.defense.slice(1); // the pitcher does not bat under the DH
      expect(new Set(fielders).size).toBe(8);
      for (const id of fielders) {
        expect(batting.has(id)).toBe(true);
      }
      // Exactly one of the nine is the designated hitter.
      expect(t.lineup.filter((id) => !fielders.includes(id))).toHaveLength(1);
    }
  });

  it('adapts into a league every mode can play', () => {
    const world = adaptWorld(bundle);
    expect(world.teams).toHaveLength(MBD_FRANCHISES.length);
    for (const t of world.teams) {
      expect(t.lineup).toHaveLength(9);
      expect(t.players.length).toBeGreaterThanOrEqual(20);
      const starter = t.players.find((p) => p.id === t.rotation[0]);
      expect(starter?.pitch).toBeTruthy();
    }
    // And more than one ballpark, which is the park factor doing its job.
    expect(new Set(world.teams.map((t) => t.homeStadium)).size).toBeGreaterThan(1);
  });
});

// ------------------------------------------------------- the loaded league

/**
 * EVERY MODE PLAYS THE LEAGUE THAT IS LOADED.
 *
 * These three helpers used to walk this game's own ten-club identity table,
 * which was correct for exactly as long as there was only one possible league.
 * With thirty-two MBD clubs in front of them the failure is not a crash — it is
 * worse than a crash. Quick Play's left/right would name clubs that are not in
 * the game, and every ballpark would quietly become Anchor Yard, throwing away
 * the park-factor decision without a word.
 */
describe('every mode plays the league that is loaded', () => {
  const world = adaptWorld(buildFixtureBundle());

  it('cycles inside the loaded league and nowhere else', () => {
    const ids = new Set(world.teams.map((t) => t.id));
    let id = world.teams[0].id;
    // A full lap, plus one: it must come back to where it started rather than
    // wandering into a league that is not on the field.
    for (let i = 0; i <= world.teams.length; i++) {
      id = nextTeamId(world.teams, id);
      expect(ids.has(id)).toBe(true);
    }
    expect(id).toBe(world.teams[1].id);
  });

  it('never lands on the club it was told to avoid', () => {
    const forbid = world.teams[3].id;
    let id = world.teams[0].id;
    for (let i = 0; i < world.teams.length * 2; i++) {
      id = shiftTeam(world.teams, id, 1, forbid);
      expect(id).not.toBe(forbid);
    }
    for (let i = 0; i < world.teams.length * 2; i++) {
      id = shiftTeam(world.teams, id, -1, forbid);
      expect(id).not.toBe(forbid);
    }
  });

  it('gives every imported club its own ballpark, not a default', () => {
    // The bug this replaces: an unknown id fell through to 'anchor-yard', so all
    // thirty-two clubs shared one park and the park factor meant nothing.
    const parks = new Set<string>();
    for (const t of world.teams) {
      const park = homeStadiumOf(world.teams, t.id);
      expect(STADIUM_BY_ID[park]).toBeTruthy();
      expect(park).toBe(t.homeStadium);
      expect(park).toBe(parkForFactor(MBD_FRANCHISES.find((f) => f.id === t.id)!.parkFactor));
      parks.add(park);
    }
    expect(parks.size).toBeGreaterThan(1);
  });

  it('still finds a Meridian park while an MBD world is loaded', () => {
    // A saved season holds this game's own club ids and has to keep finding its
    // ballparks even when the league on the field is somebody else's.
    for (const t of TEAM_IDENTITIES) {
      expect(homeStadiumOf(world.teams, t.id)).toBe(t.homeStadium);
    }
  });
});

// -------------------------------------------------------------------- receipts

describe('one game settles once, or not at all', () => {
  /** Plays a real game to completion with both sides on the CPU. */
  function playOut(bundle: MbdArcadeWorldBundleV1) {
    const world = adaptWorld(bundle);
    const g = bundle.game!;
    const setup: GameSetup = {
      awayTeamId: g.awayTeamId,
      homeTeamId: g.homeTeamId,
      stadiumId: world.homeParks[g.homeTeamId],
      innings: 3,
      difficulty: 'pro',
      awayControl: 'cpu',
      homeControl: 'cpu',
      night: false,
      seed: 606,
    };
    const away = world.teams.find((t) => t.id === g.awayTeamId)!;
    const home = world.teams.find((t) => t.id === g.homeTeamId)!;
    const state = createGameState(setup, away, home);
    const inputs = emptyInputPair();
    for (let i = 0; i < 120 * 60 * 40 && state.phase !== 'final'; i++) {
      clearEdges(inputs.p1);
      clearEdges(inputs.p2);
      stepGame(state, inputs);
    }
    expect(state.phase).toBe('final');
    return { world, result: finishGame(state) };
  }

  it('plays a real MBD matchup through the actual engine', () => {
    const bundle = buildFixtureBundle({
      mode: 'dynasty_scheduled_game',
      matchup: { awayTeamId: 'bos', homeTeamId: 'nym' },
    });
    expect(validateBundle(bundle).ok).toBe(true);
    const { result } = playOut(bundle);
    expect(result.awayRuns + result.homeRuns).toBeGreaterThanOrEqual(0);
    expect(result.innings).toBeGreaterThanOrEqual(3);
  });

  it('issues a receipt that reconciles against its own package', () => {
    const bundle = buildFixtureBundle({
      mode: 'dynasty_scheduled_game',
      matchup: { awayTeamId: 'lax', homeTeamId: 'sfb' },
    });
    const { result } = playOut(bundle);
    const receipt = buildReceipt({
      bundle,
      result,
      gameplayMode: 'cpu-vs-cpu',
      difficultyId: 'pro',
    })!;
    expect(receipt).not.toBeNull();
    expect(receipt.gameKey).toBe(bundle.game!.gameKey);
    // The binding travels intact; MBD is the only end that can check it is
    // still valid, and it cannot check what it did not receive.
    expect(receipt.source.bundleHash).toBe(bundle.source.bundleHash);
    expect(receipt.source.saveId).toBe(bundle.source.saveId);
    expect(reconcileReceipt(receipt, bundle)).toEqual([]);
  });

  it('produces no importable receipt at all for an exhibition package', () => {
    // Not an empty receipt, not a receipt MBD has to know to discard: none.
    const bundle = buildFixtureBundle({ teams: 4 });
    const { result } = playOut({
      ...bundle,
      mode: 'dynasty_scheduled_game',
      game: buildFixtureBundle({ mode: 'dynasty_scheduled_game', teams: 4 }).game,
    } as MbdArcadeWorldBundleV1);
    expect(
      buildReceipt({ bundle, result, gameplayMode: 'cpu-vs-cpu', difficultyId: 'pro' }),
    ).toBeNull();
  });

  it('catches a final score that does not reconstruct from the box score', () => {
    const bundle = buildFixtureBundle({
      mode: 'dynasty_scheduled_game',
      matchup: { awayTeamId: 'chi', homeTeamId: 'det' },
    });
    const { result } = playOut(bundle);
    const receipt = buildReceipt({
      bundle,
      result,
      gameplayMode: 'cpu-vs-cpu',
      difficultyId: 'pro',
    })!;
    receipt.final.homeScore += 3;
    const problems = reconcileReceipt(receipt, bundle);
    expect(problems.some((p) => p.rule === 'final')).toBe(true);
  });

  it('catches a receipt issued against a different bundle', () => {
    const bundle = buildFixtureBundle({
      mode: 'dynasty_scheduled_game',
      matchup: { awayTeamId: 'sea', homeTeamId: 'por' },
    });
    const { result } = playOut(bundle);
    const receipt = buildReceipt({
      bundle,
      result,
      gameplayMode: 'cpu-vs-cpu',
      difficultyId: 'pro',
    })!;
    receipt.source.bundleHash = 'sha256:some-other-export';
    expect(reconcileReceipt(receipt, bundle).some((p) => p.rule === 'source')).toBe(true);
  });

  it('catches somebody who was never made eligible to appear', () => {
    const bundle = buildFixtureBundle({
      mode: 'dynasty_scheduled_game',
      matchup: { awayTeamId: 'atl', homeTeamId: 'mia' },
    });
    const { result } = playOut(bundle);
    const receipt = buildReceipt({
      bundle,
      result,
      gameplayMode: 'cpu-vs-cpu',
      difficultyId: 'pro',
    })!;
    // A player from a third club, which is the shape of the bug that would let
    // an arcade result quietly credit the wrong dynasty.
    const stranger = bundle.players.find(
      (p) => p.teamId !== bundle.game!.homeTeamId && p.teamId !== bundle.game!.awayTeamId,
    )!;
    receipt.playerLines.push({
      ...receipt.playerLines[0],
      playerId: stranger.id,
      teamId: stranger.teamId,
    });
    expect(reconcileReceipt(receipt, bundle).some((p) => p.rule === 'eligibility')).toBe(true);
  });

  it('reports nothing as applied when nothing was applied', () => {
    // "No double modifiers" cuts both ways: a receiver that claims to have
    // applied a modifier it does not understand is as wrong as one that applies
    // it twice.
    const bundle = buildFixtureBundle({ mode: 'dynasty_scheduled_game', teams: 4 });
    const { result } = playOut(bundle);
    const receipt = buildReceipt({
      bundle,
      result,
      gameplayMode: 'cpu-vs-cpu',
      difficultyId: 'pro',
    })!;
    expect(receipt.appliedModifierIds).toEqual([]);
  });
});
