'use client';

import {
  pauseSceneHistory,
  resumeSceneHistory,
  useRegistry,
  useScene,
  type AnyNodeId,
} from '@pascal-app/core';
import { TransformControls } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { NodeRenderer, useViewer } from '@pascal-app/viewer';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Stadium } from '../../../../src/core/types';
import { BASES } from '../../../../src/core/constants';
import { fenceAt, fenceOutline } from '../../../../src/data/stadiums';
import { anchorPosition, constrainFenceAnchor } from '../fence-edit';
import {
  type MbdBallparkRoot,
  type MbdBatterEye,
  MbdFenceProfile,
  type MbdFieldReference,
  type MbdLightTower,
  type MbdScoreboard,
  type MbdSemanticNode,
  type MbdStandProfile,
} from './nodes';

function selectNode(event: ThreeEvent<MouseEvent>, id: string): void {
  event.stopPropagation();
  useViewer.getState().setSelection({ selectedIds: [id as AnyNodeId] });
}

function useGroupRegistry(id: string, type: string) {
  const ref = useRef<THREE.Group>(null);
  useRegistry(id, type, ref as React.RefObject<THREE.Object3D>);
  return ref;
}

/** Drei's wide-line material is not supported by Pascal's WebGPU renderer. */
function StudioLine({ color, lineWidth = 1, points }: {
  color: string;
  lineWidth?: number;
  points: Array<[number, number, number]>;
}) {
  const object = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(
      points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    );
    const material = new THREE.LineBasicMaterial({ color, linewidth: lineWidth });
    return new THREE.Line(geometry, material);
  }, [color, lineWidth, points]);
  useEffect(() => () => {
    object.geometry.dispose();
    object.material.dispose();
  }, [object]);
  return <primitive object={object} />;
}

function RootRenderer({ node }: { node: MbdBallparkRoot }) {
  const ref = useGroupRegistry(node.id, node.type);
  const nodes = useScene((state) => state.nodes);
  const childIds = useMemo(
    () => Object.values(nodes)
      .filter((candidate) => candidate.parentId === node.id)
      .map((candidate) => candidate.id),
    [node.id, nodes],
  );
  return (
    <group ref={ref}>
      {childIds.map((id) => <NodeRenderer key={id} nodeId={id} />)}
    </group>
  );
}

function FieldReferenceRenderer({ node }: { node: MbdFieldReference }) {
  const ref = useGroupRegistry(node.id, node.type);
  const diamond = [BASES.HOME, BASES.FIRST, BASES.SECOND, BASES.THIRD, BASES.HOME]
    .map((base) => [base.x, 0.035, base.z] as [number, number, number]);
  return (
    <group ref={ref} position={node.position}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.005}>
        <circleGeometry args={[146, 72, Math.PI / 4, Math.PI / 2]} />
        <meshStandardMaterial color="#234f2b" transparent opacity={0.36} side={THREE.DoubleSide} />
      </mesh>
      <StudioLine color="#f4f0df" lineWidth={1.5} points={diamond} />
      <StudioLine color="#f4f0df" points={[[0, 0.04, 0], [-85, 0.04, 85]]} />
      <StudioLine color="#f4f0df" points={[[0, 0.04, 0], [85, 0.04, 85]]} />
      <StudioLine color="#e76565" points={[[-150, 0.06, 0], [150, 0.06, 0]]} />
      <StudioLine color="#5f93ff" points={[[0, 0.06, -20], [0, 0.06, 160]]} />
      {[BASES.HOME, BASES.FIRST, BASES.SECOND, BASES.THIRD].map((base, index) => (
        <mesh key={index} position={[base.x, 0.08, base.z]} rotation-y={Math.PI / 4}>
          <boxGeometry args={[0.55, 0.1, 0.55]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
      ))}
    </group>
  );
}

function previewStadium(anchors: MbdFenceProfile['anchors']): Stadium {
  return {
    id: 'studio-preview', name: 'Studio Preview', city: '', blurb: '',
    fence: anchors.map((anchor) => ({ angle: anchor.angleDeg, dist: anchor.distanceM, height: anchor.heightM })),
    carry: 1, wind: { x: 0, z: 0 }, domed: false, turf: false,
    palette: { grass: 0, grassAlt: 0, dirt: 0, wall: 0, wallTrim: 0, stands: 0, sky: 0, skyNight: 0, structure: 0 },
    skyline: 'plains',
  };
}

function FenceAnchorHandle({ node, index, active, onActivate }: {
  node: MbdFenceProfile;
  index: number;
  active: boolean;
  onActivate(): void;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const start = useRef<MbdFenceProfile['anchors'] | null>(null);
  const latest = useRef<MbdFenceProfile['anchors'] | null>(null);
  const anchor = node.anchors[index];
  const position = anchorPosition(anchor);
  const updateFromHandle = () => {
    const object = mesh.current;
    if (!object) return;
    const live = MbdFenceProfile.safeParse(useScene.getState().nodes[node.id as AnyNodeId]);
    if (!live.success) return;
    const anchors = live.data.anchors.map((candidate) => ({ ...candidate }));
    anchors[index] = constrainFenceAnchor(anchors, index, [object.position.x, object.position.y, object.position.z]);
    latest.current = anchors;
    useScene.getState().updateNode(node.id as AnyNodeId, { anchors } as never);
  };
  const handle = (
    <mesh
      ref={mesh}
      position={position}
      onClick={(event) => {
        selectNode(event, node.id);
        onActivate();
      }}
    >
      <sphereGeometry args={[active ? 1.05 : 0.8, 12, 8]} />
      <meshStandardMaterial color={active ? '#ffbd4a' : '#f4e3a1'} emissive={active ? '#7a4310' : '#221b0b'} />
    </mesh>
  );
  if (!active) return handle;
  return (
    <TransformControls
      mode="translate"
      size={0.72}
      onMouseDown={() => {
        start.current = node.anchors.map((candidate) => ({ ...candidate }));
        latest.current = start.current;
        pauseSceneHistory(useScene);
      }}
      onObjectChange={updateFromHandle}
      onMouseUp={() => {
        const initial = start.current;
        const final = latest.current;
        if (initial && final) {
          useScene.getState().updateNode(node.id as AnyNodeId, { anchors: initial } as never);
          resumeSceneHistory(useScene);
          useScene.getState().updateNode(node.id as AnyNodeId, { anchors: final } as never);
        } else {
          resumeSceneHistory(useScene);
        }
        start.current = null;
        latest.current = null;
      }}
    >
      {handle}
    </TransformControls>
  );
}

function FenceRenderer({ node }: { node: MbdFenceProfile }) {
  const ref = useGroupRegistry(node.id, node.type);
  const [activeAnchor, setActiveAnchor] = useState<number | null>(null);
  const points = useMemo(() => fenceOutline(previewStadium(node.anchors), 90), [node.anchors]);
  const ground = points.map((point) => [point.x, 0.08, point.z] as [number, number, number]);
  const top = points.map((point) => [point.x, point.h, point.z] as [number, number, number]);
  return (
    <group ref={ref} onClick={(event) => selectNode(event, node.id)}>
      <StudioLine color="#37c4ba" lineWidth={3} points={ground} />
      <StudioLine color="#f5c55b" lineWidth={3} points={top} />
      {node.anchors.map((anchor, index) => {
        const base = anchorPosition(anchor);
        return <StudioLine key={`post-${index}`} color="#81ede3" points={[[base[0], 0, base[2]], base]} />;
      })}
      {node.anchors.map((_, index) => (
        <FenceAnchorHandle
          active={activeAnchor === index}
          index={index}
          key={`anchor-${index}`}
          node={node}
          onActivate={() => setActiveAnchor(index)}
        />
      ))}
    </group>
  );
}

function useSiblingFence(parentId: string | null): Stadium | null {
  const nodes = useScene((state) => state.nodes);
  return useMemo(() => {
    const candidates = Object.values(nodes) as unknown as Array<{ parentId: string | null; type: string }>;
    const node = candidates.find((candidate) => candidate.parentId === parentId && candidate.type === 'mbd:fence-profile');
    const parsed = MbdFenceProfile.safeParse(node);
    return parsed.success ? previewStadium(parsed.data.anchors) : null;
  }, [nodes, parentId]);
}

function StandRenderer({ node }: { node: MbdStandProfile }) {
  const ref = useGroupRegistry(node.id, node.type);
  const stadium = useSiblingFence(node.parentId);
  if (!node.enabled || !stadium) return <group ref={ref} />;
  const outline = fenceOutline(stadium, 48);
  return (
    <group ref={ref} onClick={(event) => selectNode(event, node.id)}>
      {Array.from({ length: node.tiers }, (_, tier) => {
        const scale = 1 + (5 + tier * 4 * node.depthScale) / 115;
        const points = outline.map((point) => [point.x * scale, 1 + tier * 2.2 * node.heightScale, point.z * scale] as [number, number, number]);
        return <StudioLine color="#7890ae" key={tier} lineWidth={4} points={points} />;
      })}
    </group>
  );
}

function BatterEyeRenderer({ node }: { node: MbdBatterEye }) {
  const ref = useGroupRegistry(node.id, node.type);
  const stadium = useSiblingFence(node.parentId);
  if (!node.enabled || !stadium) return <group ref={ref} />;
  const middle = (node.startAngleDeg + node.endAngleDeg) / 2;
  const radians = (middle * Math.PI) / 180;
  const fence = fenceAt(stadium, middle);
  const radius = fence.dist + 1 + node.depthM / 2;
  const width = radius * ((node.endAngleDeg - node.startAngleDeg) * Math.PI / 180);
  return (
    <group ref={ref} onClick={(event) => selectNode(event, node.id)}>
      <mesh position={[Math.sin(radians) * radius, node.heightM / 2, Math.cos(radians) * radius]} rotation-y={radians}>
        <boxGeometry args={[width, node.heightM, node.depthM]} />
        <meshStandardMaterial color="#142e28" />
      </mesh>
    </group>
  );
}

function ScoreboardRenderer({ node }: { node: MbdScoreboard }) {
  const ref = useGroupRegistry(node.id, node.type);
  const stadium = useSiblingFence(node.parentId);
  if (!node.enabled || !stadium) return <group ref={ref} />;
  const radians = (node.angleDeg * Math.PI) / 180;
  const radius = fenceAt(stadium, node.angleDeg).dist + node.distanceBeyondFenceM;
  return (
    <group
      ref={ref}
      position={[Math.sin(radians) * radius, 0, Math.cos(radians) * radius]}
      rotation-y={radians}
      onClick={(event) => selectNode(event, node.id)}
    >
      <mesh position={[0, node.elevationM + node.heightM / 2, 0]}>
        <boxGeometry args={[node.widthM, node.heightM, 1.2]} />
        <meshStandardMaterial color="#202936" />
      </mesh>
      <mesh position={[0, node.elevationM + node.heightM / 2, -0.65]}>
        <planeGeometry args={[node.widthM * 0.84, node.heightM * 0.72]} />
        <meshStandardMaterial color="#080c12" emissive="#16232f" />
      </mesh>
    </group>
  );
}

function LightTowerRenderer({ node }: { node: MbdLightTower }) {
  const ref = useGroupRegistry(node.id, node.type);
  const stadium = useSiblingFence(node.parentId);
  if (!node.enabled || !stadium) return <group ref={ref} />;
  const radians = (node.angleDeg * Math.PI) / 180;
  const radius = fenceAt(stadium, node.angleDeg).dist + node.distanceBeyondFenceM;
  return (
    <group
      ref={ref}
      position={[Math.sin(radians) * radius, 0, Math.cos(radians) * radius]}
      rotation-y={radians}
      onClick={(event) => selectNode(event, node.id)}
    >
      <mesh position-y={node.heightM / 2}>
        <cylinderGeometry args={[0.5, 0.9, node.heightM, 6]} />
        <meshStandardMaterial color="#697482" />
      </mesh>
      <mesh position={[0, node.heightM + 1.5, 0]}>
        <boxGeometry args={[9, 4.5, 1]} />
        <meshStandardMaterial color="#fff2bd" emissive="#837434" />
      </mesh>
    </group>
  );
}

export default function SemanticRenderer({ node }: { node: MbdSemanticNode }) {
  switch (node.type) {
    case 'mbd:ballpark-root': return <RootRenderer node={node} />;
    case 'mbd:field-reference': return <FieldReferenceRenderer node={node} />;
    case 'mbd:fence-profile': return <FenceRenderer node={node} />;
    case 'mbd:stand-profile': return <StandRenderer node={node} />;
    case 'mbd:batter-eye': return <BatterEyeRenderer node={node} />;
    case 'mbd:scoreboard': return <ScoreboardRenderer node={node} />;
    case 'mbd:light-tower': return <LightTowerRenderer node={node} />;
  }
}
