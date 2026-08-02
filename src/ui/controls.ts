import { humanIsBatting, humanIsPitching } from '../sim/game';
import { lookupPlayer } from '../sim/state';
import type { GameState } from '../sim/state';
import { PITCHES } from '../data/pitches';

/**
 * WHAT THE BUTTONS MEAN RIGHT NOW.
 *
 * The control scheme has one rule: the four action buttons are the base
 * diamond, and nothing is context-sensitive *within* a situation — but the
 * situations themselves change, and a player must never have to remember which
 * one they are in.
 *
 * Both places that answer that question read from here: the keyboard prompt bar
 * along the bottom, and the labels printed on the on-screen touch pad. On a
 * phone there is no prompt bar to glance at and no key cap to read, so the
 * label *is* the button. If the two ever disagreed, the touch build would be
 * lying about its own controls — so they share one source.
 *
 * Labels are sized for a thumb-width button. The prompt bar shows the same
 * words, which makes the bar read as the diamond it is describing rather than
 * as a sentence.
 */

export type ControlSituation = 'batting' | 'baserunning' | 'pitching' | 'fielding' | 'idle';

export interface ControlLabels {
  situation: ControlSituation;
  /** Heading for the four diamond buttons, e.g. 'THROW TO'. May be ''. */
  verb: string;
  /** What the stick / movement keys do, or '' when they do nothing. */
  stick: string;
  diamondUp: string;
  diamondDown: string;
  diamondLeft: string;
  diamondRight: string;
  special: string;
  /** What holding the modifier is for, phrased as a prefix ('STEAL', 'BACK'). */
  modifier: string;
  switchFielder: string;
}

const NONE: ControlLabels = {
  situation: 'idle',
  verb: '',
  stick: '',
  diamondUp: '',
  diamondDown: '',
  diamondLeft: '',
  diamondRight: '',
  special: '',
  modifier: '',
  switchFielder: '',
};

/**
 * The current meaning of every control, or an 'idle' set while the CPU has the
 * half-inning and the player has nothing to press.
 *
 * `modifierArmed` is the modifier being held (keyboard) or latched (touch). It
 * genuinely changes what the diamond does, so it changes what the diamond says
 * — which is how a player finds out the modifier exists without reading a
 * manual: press it, watch four captions change, let go.
 */
export function controlLabels(state: GameState, modifierArmed = false): ControlLabels {
  const batting = humanIsBatting(state);
  const pitching = humanIsPitching(state);
  const inPlay = state.phase === 'inplay';

  if (inPlay && batting) {
    return {
      situation: 'baserunning',
      verb: modifierArmed ? 'SEND BACK TO' : 'SEND TO',
      stick: '',
      diamondUp: '2ND',
      diamondLeft: '3RD',
      diamondDown: 'HOME',
      diamondRight: '1ST',
      special: modifierArmed ? 'ALL BACK' : 'ALL',
      modifier: 'BACK',
      switchFielder: '',
    };
  }

  if (inPlay && pitching) {
    return {
      situation: 'fielding',
      verb: 'THROW TO',
      // Auto-fielding is silent otherwise, and a fielder running on its own
      // while you hold the controls is exactly the kind of thing a player
      // should never have to guess about.
      stick: state.autoFielding ? 'AUTO — MOVE TO TAKE OVER' : 'MOVE FIELDER',
      diamondUp: '2ND',
      diamondLeft: '3RD',
      diamondDown: 'HOME',
      diamondRight: '1ST',
      special: 'DIVE',
      modifier: '',
      switchFielder: 'SWITCH',
    };
  }

  if (batting) {
    const canSteal = state.runners.some((r) => !r.out && !r.scored && !r.isBatter);
    if (modifierArmed && canSteal) {
      // The diamond stops being the swing selector and becomes the bases.
      return {
        situation: 'batting',
        verb: 'STEAL',
        stick: 'MOVE AIM',
        diamondUp: '2ND',
        diamondLeft: '3RD',
        diamondDown: 'HOME',
        diamondRight: '1ST',
        special: '',
        modifier: 'STEAL',
        switchFielder: '',
      };
    }
    return {
      situation: 'batting',
      verb: 'AT BAT',
      stick: 'MOVE AIM',
      diamondUp: 'TAKE',
      diamondLeft: 'BUNT',
      diamondDown: 'SWING',
      diamondRight: 'POWER',
      special: '',
      modifier: canSteal ? 'STEAL' : '',
      switchFielder: '',
    };
  }

  if (pitching) {
    // The diamond selects a pitch slot — left, down, right, up = 1..4 — and it
    // is captioned with the pitch itself rather than the slot number. "SL"
    // tells you what you are about to throw; "PITCH 3" makes you look it up on
    // another panel while a hitter waits.
    const rep = lookupPlayer(state, state.pitcher.playerId).repertoire ?? ['fastball'];
    const slot = (i: number) => (rep[i] ? PITCHES[rep[i]].short : '');
    if (modifierArmed) {
      // Holding the modifier turns the diamond into the manager's card. The
      // order matches ALIGN_BY_BASE in the engine.
      return {
        situation: 'pitching',
        verb: 'SET DEFENCE',
        stick: 'AIM / STEER',
        diamondUp: 'DP',
        diamondLeft: 'IN',
        diamondRight: 'CORNERS',
        diamondDown: 'NO XBH',
        special: 'NORMAL',
        modifier: 'DEFENCE',
        switchFielder: 'AROUND',
      };
    }
    return {
      situation: 'pitching',
      verb: 'PITCH',
      stick: 'AIM / STEER',
      diamondLeft: slot(0),
      diamondDown: slot(1),
      diamondRight: slot(2),
      diamondUp: slot(3),
      special: '',
      modifier: 'DEFENCE',
      switchFielder: 'AROUND',
    };
  }

  return NONE;
}

export type PromptAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'diamondUp'
  | 'diamondDown'
  | 'diamondLeft'
  | 'diamondRight'
  | 'special'
  | 'modifier'
  | 'switchFielder';

/**
 * The same information as a list of [key cap, label] pairs for the keyboard
 * prompt bar, given a function that names the key bound to an action.
 */
export function promptPairs(
  labels: ControlLabels,
  key: (action: PromptAction) => string,
): [string, string][] {
  const out: [string, string][] = [];
  const push = (k: string, label: string) => {
    if (label) out.push([k, label]);
  };

  if (labels.stick) {
    push(`${key('up')}${key('left')}${key('down')}${key('right')}`, labels.stick);
  }
  // Read in diamond order so the bar mirrors the shape on screen.
  const v = labels.verb && labels.situation !== 'batting' ? `${labels.verb} ` : '';
  push(key('diamondUp'), labels.diamondUp && v + labels.diamondUp);
  push(key('diamondLeft'), labels.diamondLeft && v + labels.diamondLeft);
  push(key('diamondDown'), labels.diamondDown && v + labels.diamondDown);
  push(key('diamondRight'), labels.diamondRight && v + labels.diamondRight);
  push(key('special'), labels.special === 'ALL' ? 'ADVANCE ALL' : labels.special);
  if (labels.modifier) push(`${key('modifier')}+DIR`, labels.modifier);
  push(key('switchFielder'), labels.switchFielder);
  return out;
}
