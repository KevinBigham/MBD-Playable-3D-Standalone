import { loadPlugin, useScene } from '@pascal-app/core';
import { builtinPlugin } from '@pascal-app/nodes';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BALLPARK_ASSETS } from '../../../src/ballpark/assets';
import { serializeBallparkAsset, validateBallparkAsset } from '../../../src/ballpark/contract';
import App from './App';
import { mbdBallparkPlugin } from './plugin/definitions';
import { currentStudioScene, loadAssetIntoStudio, studioSceneToAsset } from './scene';
import './styles.css';

const LOCAL_SCENE_KEY = 'mbd.pascal-ballpark-studio.asset.v1';

await loadPlugin(builtinPlugin);
await loadPlugin(mbdBallparkPlugin);

let initial = BALLPARK_ASSETS[0];
const saved = localStorage.getItem(LOCAL_SCENE_KEY);
if (saved) {
  try {
    const parsed = validateBallparkAsset(JSON.parse(saved));
    if (parsed.ok) initial = parsed.asset;
  } catch {
    // A corrupt local draft is ignored; the promoted showcase is always safe.
  }
}
loadAssetIntoStudio(initial);

let persistenceQueued = false;
useScene.subscribe(() => {
  if (persistenceQueued) return;
  persistenceQueued = true;
  queueMicrotask(() => {
    persistenceQueued = false;
    try {
      localStorage.setItem(LOCAL_SCENE_KEY, serializeBallparkAsset(studioSceneToAsset(currentStudioScene())));
    } catch {
      // Live invalid edits stay visible in the validator; only valid scenes persist.
    }
  });
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
