import {
  BRIDGE_VERSION,
  BUNDLE_FORMAT,
  type ArcadeGameSide,
  type ArcadePlayer,
  type MbdArcadeWorldBundleV1,
} from './contract';
import { ratingIsSelfConsistent } from './rating';

/**
 * FAIL CLOSED.
 * ============
 *
 * A bundle arrives as a file. It may be from a different version of MBD, a
 * different save than the one the player thinks, a partial export, or an
 * afternoon of somebody editing JSON by hand. The temptation with all of those
 * is to be helpful: fill in the missing ninth hitter, pick another starter,
 * skip the player whose team ID does not match. Every one of those repairs
 * produces a game that *looks* like the dynasty and is not, and the receipt it
 * generates is then a lie that MBD has no way to detect.
 *
 * So this rejects. It names the rule and the offending IDs, and it does nothing
 * else. The handoff says it in one line — "Reject a dynasty package on a
 * mismatch; do not silently repair it in the bridge" — and that line is the
 * whole design of this file.
 *
 * What is checked here is *internal consistency*, which is everything a
 * receiving game can check on its own. Whether the source snapshot is still
 * current, whether the schedule row is still reserved, and whether this receipt
 * has been accepted before are all MBD's questions, and MBD is the only end
 * that can answer them.
 */

export interface BundleProblem {
  /** Short, stable identifier for the rule that failed. */
  rule: string;
  detail: string;
}

export interface BundleCheck {
  ok: boolean;
  problems: BundleProblem[];
  /** Non-fatal observations worth surfacing in the import screen. */
  warnings: BundleProblem[];
}

const POSITION_PLAYER_SLOTS = 9;

function problem(rule: string, detail: string): BundleProblem {
  return { rule, detail };
}

/** True when the value is a finite number in [lo, hi]. */
function inRange(v: unknown, lo: number, hi: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

export function validateBundle(input: unknown): BundleCheck {
  const problems: BundleProblem[] = [];
  const warnings: BundleProblem[] = [];
  const fail = (rule: string, detail: string): BundleCheck => ({
    ok: false,
    problems: [...problems, problem(rule, detail)],
    warnings,
  });

  if (!input || typeof input !== 'object') {
    return fail('shape', 'the file did not contain a JSON object');
  }
  const b = input as Partial<MbdArcadeWorldBundleV1>;

  // --- envelope. Wrong format or version stops everything: a v2 bundle read as
  // a v1 one is the exact failure this field exists to prevent.
  if (b.format !== BUNDLE_FORMAT) {
    return fail('format', `expected "${BUNDLE_FORMAT}", found "${String(b.format)}"`);
  }
  if (b.bridgeVersion !== BRIDGE_VERSION) {
    return fail(
      'bridgeVersion',
      `this build speaks bridge v${BRIDGE_VERSION}; the bundle is v${String(b.bridgeVersion)}`,
    );
  }
  if (b.mode !== 'exhibition' && b.mode !== 'dynasty_scheduled_game') {
    return fail('mode', `unknown mode "${String(b.mode)}"`);
  }
  if (!b.source || typeof b.source !== 'object') return fail('source', 'missing source binding');
  if (!b.source.sourceSnapshotHash || !b.source.bundleHash) {
    // Required even for an exhibition pack with no save: without them there is
    // no way to say which export a result came from.
    return fail('source', 'sourceSnapshotHash and bundleHash are both required');
  }
  if (b.mode === 'dynasty_scheduled_game' && !b.source.saveId) {
    return fail('source', 'a dynasty package must name the save it came from');
  }
  if (!Array.isArray(b.teams) || !Array.isArray(b.players) || !Array.isArray(b.organizations)) {
    return fail('shape', 'teams, players and organizations must all be arrays');
  }

  // --- identity joins. IDs are the joins; a duplicate ID means two different
  // people or clubs are now the same one, which no downstream check can undo.
  const teamById = new Map<string, MbdArcadeWorldBundleV1['teams'][number]>();
  for (const t of b.teams) {
    if (!t?.id) return fail('team.id', 'a team has no id');
    if (teamById.has(t.id)) return fail('team.id', `duplicate team id "${t.id}"`);
    teamById.set(t.id, t);
  }
  const playerById = new Map<string, ArcadePlayer>();
  for (const p of b.players) {
    if (!p?.id) return fail('player.id', 'a player has no id');
    if (playerById.has(p.id)) return fail('player.id', `duplicate player id "${p.id}"`);
    playerById.set(p.id, p);
  }
  if (teamById.size === 0) return fail('teams', 'the bundle contains no teams');

  // --- every player belongs to a club that is actually in the bundle.
  const orphans = b.players.filter((p) => !teamById.has(p.teamId)).map((p) => p.id);
  if (orphans.length) {
    return fail(
      'player.teamId',
      `${orphans.length} player(s) name a team not in this bundle: ${orphans.slice(0, 5).join(', ')}`,
    );
  }

  // --- ratings. Only `internal` is read by this game, so a disagreement in the
  // derived fields cannot break play — but it does mean the exporter and this
  // contract have drifted, and that is worth knowing before it matters.
  let drifted = 0;
  for (const p of b.players) {
    if (!p.hitter) return fail('player.hitter', `player "${p.id}" has no hitter ratings`);
    const ratings = [
      ...Object.values(p.hitter),
      ...(p.pitcher ? Object.values(p.pitcher) : []),
      p.overall,
    ];
    for (const r of ratings) {
      if (!r || !inRange(r.internal, 0, 550)) {
        return fail('rating.internal', `player "${p.id}" has a rating outside 0..550`);
      }
      if (!ratingIsSelfConsistent(r)) drifted++;
    }
    if (p.canPitch && !p.pitcher) {
      return fail('player.canPitch', `player "${p.id}" claims canPitch with no pitcher ratings`);
    }
  }
  if (drifted > 0) {
    warnings.push(
      problem(
        'rating.derived',
        `${drifted} rating(s) have display/arcade99 values that disagree with their own internal ` +
          'value. Play is unaffected — only `internal` is read — but the exporter and this ' +
          'contract have drifted.',
      ),
    );
  }

  // --- organization rosters join back to real players on the right club.
  for (const org of b.organizations) {
    if (!teamById.has(org.teamId)) {
      return fail('org.teamId', `roster for unknown team "${org.teamId}"`);
    }
    const check = (ids: string[], where: string): BundleProblem | null => {
      for (const id of ids) {
        const p = playerById.get(id);
        if (!p) return problem('org.member', `${org.teamId} ${where} names unknown player "${id}"`);
        if (p.teamId !== org.teamId) {
          return problem(
            'org.member',
            `${org.teamId} ${where} claims "${id}", who belongs to ${p.teamId}`,
          );
        }
      }
      return null;
    };
    const bad =
      check(org.active26PlayerIds ?? [], 'active roster') ??
      check(org.fortyManPlayerIds ?? [], '40-man') ??
      check(org.defaults?.lineupPlayerIds ?? [], 'lineup') ??
      check(org.defaults?.rotationPlayerIds ?? [], 'rotation') ??
      check(org.defaults?.benchPlayerIds ?? [], 'bench');
    if (bad) return { ok: false, problems: [...problems, bad], warnings };

    const lineup = org.defaults?.lineupPlayerIds ?? [];
    if (lineup.length && lineup.length !== POSITION_PLAYER_SLOTS) {
      return fail(
        'org.lineup',
        `${org.teamId} has a ${lineup.length}-man lineup; a legal one is ${POSITION_PLAYER_SLOTS}`,
      );
    }
    if (new Set(lineup).size !== lineup.length) {
      return fail('org.lineup', `${org.teamId} bats somebody twice`);
    }
    const ineligible = lineup.filter((id) => playerById.get(id)?.availability.eligible === false);
    if (ineligible.length) {
      // The exporter is supposed to have resolved this already, which is why it
      // is fatal here rather than something to work around: if an ineligible
      // player reached a lineup slot, the export is not describing a game that
      // MBD would have allowed.
      return fail(
        'org.lineup',
        `${org.teamId} bats ineligible player(s): ${ineligible.join(', ')}`,
      );
    }
  }

  // --- a dynasty package must describe exactly one playable, legal game.
  if (b.mode === 'dynasty_scheduled_game') {
    const g = b.game;
    if (!g) return fail('game', 'a dynasty package must carry its scheduled game');
    if (!g.gameKey) return fail('game.gameKey', 'the scheduled game has no key');
    if (!teamById.has(g.homeTeamId) || !teamById.has(g.awayTeamId)) {
      return fail('game.teams', 'the scheduled game names a team not in this bundle');
    }
    if (g.homeTeamId === g.awayTeamId) {
      return fail('game.teams', 'a club cannot play itself');
    }
    const sideProblem = (side: ArcadeGameSide, which: string): BundleProblem | null => {
      if (side.teamId !== (which === 'home' ? g.homeTeamId : g.awayTeamId)) {
        return problem('game.side', `the ${which} side names the wrong club`);
      }
      if (side.lineupPlayerIds.length !== POSITION_PLAYER_SLOTS) {
        return problem(
          'game.lineup',
          `the ${which} lineup has ${side.lineupPlayerIds.length} hitters, not ${POSITION_PLAYER_SLOTS}`,
        );
      }
      const starter = playerById.get(side.startingPitcherId);
      if (!starter) return problem('game.starter', `the ${which} starter is not in this bundle`);
      if (starter.teamId !== side.teamId) {
        return problem('game.starter', `the ${which} starter belongs to another club`);
      }
      if (!starter.canPitch) {
        return problem('game.starter', `the ${which} starter has no pitcher ratings`);
      }
      const unavailable = new Set(side.unavailablePlayerIds);
      const playing = [...side.lineupPlayerIds, side.startingPitcherId];
      const wrong = playing.filter((id) => unavailable.has(id));
      if (wrong.length) {
        return problem('game.eligibility', `${which} plays unavailable player(s): ${wrong.join(', ')}`);
      }
      return null;
    };
    const bad = sideProblem(g.home, 'home') ?? sideProblem(g.away, 'away');
    if (bad) return { ok: false, problems: [...problems, bad], warnings };

    // No double modifiers starts here: a duplicate ID means the receiver cannot
    // honestly report that it applied each one once.
    const ids = g.explicitModifiers.map((m) => m.id);
    if (new Set(ids).size !== ids.length) {
      return fail('game.modifiers', 'the same modifier id appears twice');
    }
  } else if (b.game) {
    warnings.push(
      problem('game', 'an exhibition package carries a scheduled game; it will be ignored'),
    );
  }

  return { ok: problems.length === 0, problems, warnings };
}

/** One line, for a toast or a log. */
export function describeCheck(check: BundleCheck): string {
  if (check.ok) return 'bundle accepted';
  const first = check.problems[0];
  return first ? `${first.rule}: ${first.detail}` : 'bundle rejected';
}
