'use client';

import { useScene, type AnyNodeId } from '@pascal-app/core';
import { anchorPosition, constrainFenceAnchor, deleteFenceAnchor, insertFenceAnchor } from '../fence-edit';
import type { MbdFenceProfile } from './nodes';

const FEET_PER_METRE = 3.28084;

export default function FencePanel({ node }: { node: MbdFenceProfile }) {
  const update = (anchors: MbdFenceProfile['anchors']) => useScene.getState().updateNode(node.id as AnyNodeId, { anchors } as never);
  const edit = (index: number, field: 'angleDeg' | 'distanceM' | 'heightM', value: number) => {
    const anchors = node.anchors.map((anchor) => ({ ...anchor }));
    const current = anchors[index];
    if (!current) return;
    const candidate = { ...current, [field]: value };
    update(anchors.map((anchor, candidateIndex) => candidateIndex === index
      ? constrainFenceAnchor(anchors, index, anchorPosition(candidate))
      : anchor));
  };
  return <div className="custom-inspector fence-inspector">
    <div className="warning-box"><b>GAMEPLAY-AFFECTING</b> Distance and wall height feed the same fence used by Three.js and ball physics. Metres are canonical; feet are display-only.</div>
    <table>
      <thead><tr><th>Angle</th><th>Distance</th><th>Height</th><th /></tr></thead>
      <tbody>{node.anchors.map((anchor, index) => <tr key={index}>
        <td><input aria-label={`anchor ${index} angle`} type="number" step="0.25" disabled={index === 0 || index === node.anchors.length - 1} value={anchor.angleDeg} onChange={(event) => edit(index, 'angleDeg', Number(event.target.value))} /><small>°</small></td>
        <td><input aria-label={`anchor ${index} distance`} type="number" min="70" max="170" step="0.1" value={anchor.distanceM} onChange={(event) => edit(index, 'distanceM', Number(event.target.value))} /><small>{(anchor.distanceM * FEET_PER_METRE).toFixed(0)} ft</small></td>
        <td><input aria-label={`anchor ${index} height`} type="number" min="0.6" max="30" step="0.1" value={anchor.heightM} onChange={(event) => edit(index, 'heightM', Number(event.target.value))} /><small>{(anchor.heightM * FEET_PER_METRE).toFixed(1)} ft</small></td>
        <td><button disabled={index === 0 || index === node.anchors.length - 1 || node.anchors.length <= 3} onClick={() => update(deleteFenceAnchor(node.anchors, index))}>−</button></td>
      </tr>)}</tbody>
    </table>
    <div className="anchor-add-row">{node.anchors.slice(0, -1).map((_, index) => <button key={index} onClick={() => update(insertFenceAnchor(node.anchors, index))}>+ between {index + 1}/{index + 2}</button>)}</div>
  </div>;
}
