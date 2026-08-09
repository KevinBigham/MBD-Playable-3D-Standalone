'use client';

import { useScene, type AnyNodeId } from '@pascal-app/core';
import type { ChangeEvent, ReactNode } from 'react';
import { BALLPARK_SKYLINES } from '../../../../src/ballpark/contract';
import type { MbdBallparkRoot } from './nodes';

function Row({ label, gameplay, children }: { label: string; gameplay?: boolean; children: ReactNode }) {
  return <label className="inspector-row"><span>{label}{gameplay ? <b className="gameplay-flag">GAMEPLAY</b> : null}</span>{children}</label>;
}

function hex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

export default function RootPanel({ node }: { node: MbdBallparkRoot }) {
  const update = (patch: Partial<MbdBallparkRoot>) => useScene.getState().updateNode(node.id as AnyNodeId, patch as never);
  const text = (key: keyof MbdBallparkRoot) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update({ [key]: event.target.value } as Partial<MbdBallparkRoot>);
  const number = (key: keyof MbdBallparkRoot) => (event: ChangeEvent<HTMLInputElement>) => update({ [key]: Number(event.target.value) } as Partial<MbdBallparkRoot>);
  const colors = ['grass', 'grassAlt', 'dirt', 'wall', 'wallTrim', 'stands', 'sky', 'skyNight', 'structure'] as const;
  return <div className="custom-inspector">
    <h3>Ballpark identity</h3>
    <Row label="ID"><input value={node.stadiumId} onChange={text('stadiumId')} /></Row>
    <Row label="Name"><input value={node.stadiumName} onChange={text('stadiumName')} /></Row>
    <Row label="City"><input value={node.city} onChange={text('city')} /></Row>
    <Row label="Blurb"><textarea rows={3} value={node.blurb} onChange={text('blurb')} /></Row>
    <h3>Gameplay settings</h3>
    <Row label="Carry" gameplay><input type="number" min="0.8" max="1.25" step="0.01" value={node.carry} onChange={number('carry')} /></Row>
    <Row label="Wind X (m/s)" gameplay><input type="number" min="-10" max="10" step="0.1" value={node.windX} onChange={number('windX')} /></Row>
    <Row label="Wind Z (m/s)" gameplay><input type="number" min="-10" max="10" step="0.1" value={node.windZ} onChange={number('windZ')} /></Row>
    <Row label="Domed" gameplay><input type="checkbox" checked={node.domed} onChange={(event) => update({ domed: event.target.checked })} /></Row>
    <Row label="Turf" gameplay><input type="checkbox" checked={node.turf} onChange={(event) => update({ turf: event.target.checked })} /></Row>
    <Row label="Skyline"><select value={node.skyline} onChange={(event) => update({ skyline: event.target.value as MbdBallparkRoot['skyline'] })}>{BALLPARK_SKYLINES.map((value) => <option key={value}>{value}</option>)}</select></Row>
    <h3>Palette</h3>
    {colors.map((key) => <Row key={key} label={key}><input type="color" value={hex(node[key])} onChange={(event) => update({ [key]: Number.parseInt(event.target.value.slice(1), 16) } as Partial<MbdBallparkRoot>)} /></Row>)}
    <h3>Authoring</h3>
    <Row label="Author"><input value={node.author ?? ''} onChange={text('author')} /></Row>
    <Row label="Notes"><textarea rows={4} value={node.notes ?? ''} onChange={text('notes')} /></Row>
  </div>;
}
