import type { GameResult } from '../core/types';
import {
  RECEIPT_FORMAT,
  BRIDGE_VERSION,
  type ArcadePlayerGameLine,
  type MbdArcadeGameReceiptV1,
  type MbdArcadeWorldBundleV1,
} from './contract';

/**
 * WHAT HAPPENED, AND NOTHING ELSE.
 * ================================
 *
 * A receipt is this game's only output that MBD will ever read, and the whole
 * discipline of it is restraint. It reports **facts about one game**: who came
 * to the plate, what happened, what the score was, how many outs each pitcher
 * recorded. It does not report what those facts *mean*.
 *
 * That distinction is the contract's, and it is load-bearing. A receipt may not
 * change ratings, contracts, roster assignment, development, morale, chemistry,
 * awards, records or narrative state — MBD derives all of those itself, through
 * the postgame pipeline it already has, once it accepts the result. If this
 * file ever grows a field like `fatigueAfter` or `confidenceDelta`, the bridge
 * has started arguing with the world authority about the world.
 *
 * Bridge v1 also returns no new injuries, ejections, suspensions, trades or
 * roster moves. Those need source-owned rules and their own compatibility work,
 * and inventing them here would be this game legislating for a game it does not
 * own.
 *
 * ONE GAME SETTLES ONCE. The receipt carries the exact source binding it was
 * issued against — save, snapshot hash, bundle hash, game key, context hash —
 * so MBD can reject a duplicate, a receipt for a different save, or a receipt
 * whose reservation has since gone stale. This end cannot check any of those;
 * it can only make sure the binding travels intact.
 *
 * FAILING TO SAVE IS NOT FAILING TO PLAY. If MBD rejects or cannot persist, the
 * receipt stays valid and retryable. Nothing here is allowed to be the only
 * copy of a game somebody actually played.
 */

/** Identifies which build produced a receipt, for MBD's audit trail. */
export const ARCADE_BUILD_ID = 'moonshot-nine/1.0';

export interface ReceiptInput {
  bundle: MbdArcadeWorldBundleV1;
  result: GameResult;
  /** Which control scheme played it, for the audit trail. */
  gameplayMode: string;
  difficultyId: string;
  /** Modifier ids this game genuinely applied. Usually empty in v1. */
  appliedModifierIds?: string[];
}

/**
 * Turns a finished game into a receipt.
 *
 * Only meaningful for a `dynasty_scheduled_game` bundle: an exhibition package
 * produces no importable receipt at all, by design, so this returns null rather
 * than a receipt MBD would have to know to throw away.
 */
export function buildReceipt(input: ReceiptInput): MbdArcadeGameReceiptV1 | null {
  const { bundle, result } = input;
  if (bundle.mode !== 'dynasty_scheduled_game' || !bundle.game) return null;
  const g = bundle.game;

  // Which club each player belongs to comes from the *bundle*, never from the
  // result. IDs are the joins, and the bundle is the thing MBD will check
  // against.
  const teamOf = new Map(bundle.players.map((p) => [p.id, p.teamId]));

  const ids = new Set([...Object.keys(result.batting), ...Object.keys(result.pitching)]);
  const playerLines: ArcadePlayerGameLine[] = [];
  for (const id of Array.from(ids).sort()) {
    const teamId = teamOf.get(id);
    // A line for somebody who is not in the package cannot be reconciled at the
    // far end, so it is dropped here and surfaced by `reconcileReceipt` rather
    // than shipped as an unresolvable join.
    if (!teamId) continue;
    const b = result.batting[id];
    const p = result.pitching[id];
    playerLines.push({
      playerId: id,
      teamId,
      batting: {
        plateAppearances: b?.pa ?? 0,
        atBats: b?.ab ?? 0,
        hits: b?.h ?? 0,
        doubles: b?.doubles ?? 0,
        triples: b?.triples ?? 0,
        homeRuns: b?.hr ?? 0,
        runs: b?.r ?? 0,
        runsBattedIn: b?.rbi ?? 0,
        walks: b?.bb ?? 0,
        strikeouts: b?.so ?? 0,
        hitByPitch: b?.hbp ?? 0,
        // MOONSHOT does not separate a sacrifice fly from other productive
        // outs in the box score, so this is honestly zero rather than a guess.
        sacrificeFlies: 0,
      },
      pitching: {
        outsRecorded: p?.outs ?? 0,
        earnedRuns: p?.er ?? 0,
        strikeouts: p?.so ?? 0,
        walks: p?.bb ?? 0,
        hitsAllowed: p?.h ?? 0,
        homeRunsAllowed: p?.hr ?? 0,
        hitBatters: p?.hbp ?? 0,
        // Not tracked separately in this game's pitching line.
        flyBallsAllowed: 0,
        decision:
          id === result.winningPitcherId
            ? 'win'
            : id === result.losingPitcherId
              ? 'loss'
              : id === result.savePitcherId
                ? 'save'
                : 'none',
      },
    });
  }

  return {
    format: RECEIPT_FORMAT,
    bridgeVersion: BRIDGE_VERSION,
    source: {
      saveId: bundle.source.saveId,
      sourceSnapshotHash: bundle.source.sourceSnapshotHash,
      bundleHash: bundle.source.bundleHash,
      season: bundle.source.season,
      day: bundle.source.day,
    },
    gameKey: g.gameKey,
    contextHash: g.contextHash,
    arcadeBuildId: ARCADE_BUILD_ID,
    gameplayMode: input.gameplayMode,
    difficultyId: input.difficultyId,
    homeTeamId: g.homeTeamId,
    awayTeamId: g.awayTeamId,
    final: {
      homeScore: result.homeRuns,
      awayScore: result.awayRuns,
      innings: result.innings,
      homeHits: result.homeHits,
      awayHits: result.awayHits,
      winningPitcherId: result.winningPitcherId ?? null,
      losingPitcherId: result.losingPitcherId ?? null,
      savePitcherId: result.savePitcherId ?? null,
    },
    // Bridge v1 does not stream plate appearances out of the engine, and an
    // empty list is the truthful thing to send rather than a reconstruction.
    // `reconcileReceipt` therefore checks the player lines against the final,
    // which is the reconciliation this build can genuinely stand behind.
    plateAppearances: [],
    playerLines,
    substitutions: [],
    appliedModifierIds: input.appliedModifierIds ?? [],
    receiptHash: '',
  };
}

export interface ReceiptProblem {
  rule: string;
  detail: string;
}

/**
 * The reconciliation MBD will do, done here first.
 *
 * Doing it at this end does not make MBD's checks unnecessary — it is the
 * importer's job to be suspicious of anything arriving over a bridge, and it
 * will check all of this again. It makes the *failure* land somewhere a person
 * can act on it: a receipt that will not reconcile is worth knowing about while
 * the game is still on screen, not after it has been carried to another
 * application and rejected there.
 */
export function reconcileReceipt(
  receipt: MbdArcadeGameReceiptV1,
  bundle: MbdArcadeWorldBundleV1,
): ReceiptProblem[] {
  const problems: ReceiptProblem[] = [];
  const add = (rule: string, detail: string) => problems.push({ rule, detail });

  if (receipt.format !== RECEIPT_FORMAT) add('format', 'not a receipt');
  if (receipt.bridgeVersion !== BRIDGE_VERSION) add('bridgeVersion', 'version mismatch');

  const g = bundle.game;
  if (!g) {
    add('game', 'the bundle carries no scheduled game to settle');
    return problems;
  }
  // The binding must travel intact or MBD cannot tell which game this settles.
  if (receipt.gameKey !== g.gameKey) add('gameKey', 'receipt does not name this scheduled game');
  if (receipt.contextHash !== g.contextHash) add('contextHash', 'the game context has changed');
  if (receipt.source.bundleHash !== bundle.source.bundleHash) {
    add('source', 'receipt was issued against a different bundle');
  }
  if (receipt.source.saveId !== bundle.source.saveId) {
    add('source', 'receipt names a different save');
  }

  const teamOf = new Map(bundle.players.map((p) => [p.id, p.teamId]));
  const eligible = new Set([
    ...g.home.activePlayerIds,
    ...g.away.activePlayerIds,
    ...g.home.benchPlayerIds,
    ...g.away.benchPlayerIds,
    ...g.home.bullpenPlayerIds,
    ...g.away.bullpenPlayerIds,
  ]);

  let homeRuns = 0;
  let awayRuns = 0;
  let homeHits = 0;
  let awayHits = 0;
  let decisions = 0;
  for (const line of receipt.playerLines) {
    const owner = teamOf.get(line.playerId);
    if (!owner) {
      add('playerLine', `"${line.playerId}" is not in this package`);
      continue;
    }
    if (owner !== line.teamId) {
      add('playerLine', `"${line.playerId}" is charged to the wrong club`);
    }
    if (!eligible.has(line.playerId)) {
      // Somebody appeared who was never made available to appear. That is
      // exactly the case rule 4 of the contract exists to catch.
      add('eligibility', `"${line.playerId}" was not eligible in the exported context`);
    }
    if (line.batting.hits > line.batting.atBats) {
      add('playerLine', `"${line.playerId}" has more hits than at-bats`);
    }
    if (line.batting.atBats > line.batting.plateAppearances) {
      add('playerLine', `"${line.playerId}" has more at-bats than plate appearances`);
    }
    const home = line.teamId === g.homeTeamId;
    if (home) {
      homeRuns += line.batting.runs;
      homeHits += line.batting.hits;
    } else {
      awayRuns += line.batting.runs;
      awayHits += line.batting.hits;
    }
    if (line.pitching.decision !== 'none') decisions++;
  }

  // The final score has to be the sum of the runs somebody scored. If those two
  // disagree the box score is not describing the game that was played, and
  // there is no way to tell from here which of the two is wrong.
  if (homeRuns !== receipt.final.homeScore) {
    add('final', `home runs total ${homeRuns} but the final says ${receipt.final.homeScore}`);
  }
  if (awayRuns !== receipt.final.awayScore) {
    add('final', `away runs total ${awayRuns} but the final says ${receipt.final.awayScore}`);
  }
  if (homeHits !== receipt.final.homeHits) {
    add('final', `home hits total ${homeHits} but the final says ${receipt.final.homeHits}`);
  }
  if (awayHits !== receipt.final.awayHits) {
    add('final', `away hits total ${awayHits} but the final says ${receipt.final.awayHits}`);
  }
  if (receipt.final.homeScore === receipt.final.awayScore) {
    add('final', 'a settled game cannot be a tie');
  }
  if (receipt.final.innings < 1) add('final', 'a settled game has at least one inning');
  if (decisions === 0) add('decisions', 'no pitcher was credited with a decision');
  if (receipt.final.winningPitcherId === receipt.final.losingPitcherId) {
    add('decisions', 'one pitcher cannot both win and lose');
  }

  return problems;
}
