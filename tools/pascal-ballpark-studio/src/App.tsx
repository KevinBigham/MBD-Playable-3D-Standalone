import { Inspector } from '@pascal-app/editor';
import { useScene, type AnyNodeId } from '@pascal-app/core';
import { useViewer, Viewer } from '@pascal-app/viewer';
import { useMemo, useState } from 'react';
import { BALLPARK_ASSETS } from '../../../src/ballpark/assets';
import { hashBallparkAsset, validateBallparkAsset, type MbdBallparkAssetV1 } from '../../../src/ballpark/contract';
import { BALLPARK_PRESETS } from './presets';
import {
  currentStudioScene,
  gameplayDifferences,
  loadAssetIntoStudio,
  studioSceneToAsset,
} from './scene';
import type { MbdSemanticNode } from './plugin/nodes';

interface LiveAsset {
  asset?: MbdBallparkAssetV1;
  errors: Array<{ path: string; message: string }>;
}

function liveAsset(): LiveAsset {
  try {
    const candidate = studioSceneToAsset(currentStudioScene());
    const result = validateBallparkAsset(candidate);
    return result.ok ? { asset: result.asset, errors: [] } : { errors: result.errors };
  } catch (error) {
    return { errors: [{ path: '$', message: error instanceof Error ? error.message : String(error) }] };
  }
}

function initialOriginal(): MbdBallparkAssetV1 {
  try {
    const scene = currentStudioScene();
    const current = studioSceneToAsset(currentStudioScene());
    const root = Object.values(scene.nodes).find((node) => node.type === 'mbd:ballpark-root');
    return BALLPARK_ASSETS.find((asset) => hashBallparkAsset(asset) === root?.importedHash)
      ?? BALLPARK_ASSETS.find((asset) => asset.stadium.id === current.stadium.id)
      ?? current;
  } catch {
    return BALLPARK_ASSETS[0];
  }
}

const NODE_LABELS: Record<MbdSemanticNode['type'], string> = {
  'mbd:ballpark-root': 'Ballpark identity & gameplay',
  'mbd:field-reference': 'Regulation field (locked)',
  'mbd:fence-profile': 'Canonical fence profile',
  'mbd:stand-profile': 'Stand profile',
  'mbd:batter-eye': "Batter's eye",
  'mbd:scoreboard': 'Scoreboard',
  'mbd:light-tower': 'Light tower',
};

export default function App() {
  const nodes = useScene((state) => state.nodes) as unknown as Record<string, MbdSemanticNode>;
  const selection = useViewer((state) => state.selection.selectedIds);
  const [original, setOriginal] = useState(initialOriginal);
  const [stageStatus, setStageStatus] = useState('Exports write only to ballpark-staging/.');
  const [importId, setImportId] = useState(original.stadium.id);
  const live = useMemo(() => liveAsset(), [nodes]);
  const differences = live.asset ? gameplayDifferences(original, live.asset) : [];
  const hash = live.asset ? hashBallparkAsset(live.asset) : 'invalid';

  const importAsset = (asset: MbdBallparkAssetV1) => {
    loadAssetIntoStudio(asset);
    setOriginal(asset);
    setImportId(asset.stadium.id);
    useViewer.getState().setSelection({ selectedIds: [`mbd-fence_${asset.stadium.id}` as AnyNodeId] });
    setStageStatus(`Imported ${asset.stadium.name}.`);
  };

  const stage = async () => {
    if (!live.asset) return;
    setStageStatus('Validating and staging…');
    const exported = studioSceneToAsset(currentStudioScene(), { exportedAt: new Date().toISOString() });
    const response = await fetch('/api/stage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(exported),
    });
    const receipt = await response.json() as { ok: boolean; path?: string; error?: string; errors?: Array<{ path: string; message: string }> };
    if (!response.ok || !receipt.ok) {
      setStageStatus(receipt.errors?.map((error) => `${error.path}: ${error.message}`).join(' · ') ?? receipt.error ?? 'Stage failed.');
      return;
    }
    setStageStatus(`STAGED ${receipt.path}. Review, impact-test, then promote explicitly.`);
  };

  const semanticNodes = Object.values(nodes)
    .filter((node) => node.type !== 'mbd:field-reference')
    .sort((left, right) => left.type.localeCompare(right.type) || left.id.localeCompare(right.id));

  return <main className="studio-shell">
    <header>
      <div><span className="eyebrow">PASCAL 0.9.2 · MBD ASSET V1</span><h1>Ballpark Studio</h1></div>
      <div className="toolbar">
        <button onClick={() => useScene.temporal.getState().undo()}>Undo</button>
        <button onClick={() => useScene.temporal.getState().redo()}>Redo</button>
        <button className="stage-button" disabled={!live.asset} onClick={() => void stage()}>Export to staging</button>
      </div>
    </header>
    <section className="studio-grid">
      <aside className="left-panel">
        <section>
          <h2>Import MBD park</h2>
          <select value={importId} onChange={(event) => setImportId(event.target.value)}>
            {BALLPARK_ASSETS.map((asset) => <option key={asset.stadium.id} value={asset.stadium.id}>{asset.stadium.name}</option>)}
          </select>
          <button onClick={() => {
            const asset = BALLPARK_ASSETS.find((candidate) => candidate.stadium.id === importId);
            if (asset) importAsset(asset);
          }}>Import selected</button>
        </section>
        <section>
          <h2>Safe presets</h2>
          <div className="preset-list">{Object.entries(BALLPARK_PRESETS).map(([id, asset]) => <button key={id} onClick={() => importAsset(asset)}>{asset.stadium.name}</button>)}</div>
        </section>
        <section>
          <h2>Semantic scene</h2>
          <div className="node-list">{semanticNodes.map((node) => <button
            className={selection.includes(node.id as AnyNodeId) ? 'selected' : ''}
            key={node.id}
            onClick={() => useViewer.getState().setSelection({ selectedIds: [node.id as AnyNodeId] })}
          >{NODE_LABELS[node.type]}{node.type === 'mbd:light-tower' ? ` · ${node.angleDeg}°` : ''}</button>)}</div>
          <div className="locked-node">◇ Regulation field reference is locked, transient, and never exported.</div>
        </section>
        <section className="receipt-card">
          <h2>Asset receipt</h2>
          <code>{hash}</code>
          <p className={live.errors.length ? 'bad' : 'good'}>{live.errors.length ? `${live.errors.length} validation error(s)` : 'Strict v1 validation passes'}</p>
          {live.errors.map((error, index) => <p className="error" key={`${error.path}-${index}`}><b>{error.path}</b> {error.message}</p>)}
          <h3>Gameplay differences</h3>
          {differences.length === 0 ? <p className="good">No gameplay-affecting changes.</p> : differences.map((difference) => <p className="warning" key={difference.field}><b>{difference.field}</b> {difference.summary}</p>)}
          <p className="stage-status">{stageStatus}</p>
        </section>
      </aside>
      <div className="viewport" aria-label="Pascal 3D ballpark viewport">
        <Viewer disablePostFx defaultRender={{ shading: 'solid', textures: false }} selectionManager="default" />
        <div className="viewport-help">Drag a gold fence anchor: X/Z changes angle + distance · Y changes wall height · endpoints stay ±45°</div>
      </div>
      <aside className="right-panel">
        <div className="inspector-title"><span>Pascal inspector</span><small>metres canonical · feet read-only</small></div>
        <Inspector />
      </aside>
    </section>
  </main>;
}
