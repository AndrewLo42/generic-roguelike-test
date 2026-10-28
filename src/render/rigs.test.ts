import { describe, expect, it } from 'vitest';
// @ts-expect-error -- no @types/node in this project; vitest runs these tests in Node.
import { readFileSync } from 'node:fs';
import { CLASSES } from '../data/classes';
import { rigOf } from './rigs';

/** Clip and node names straight from a GLB's JSON chunk (no three.js needed). */
function glbInfo(path: string) {
  const b = readFileSync(path);
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  return {
    clips: new Set<string>((json.animations ?? []).map((a: { name: string }) => a.name)),
    nodes: new Set<string>((json.nodes ?? []).map((n: { name: string }) => n.name)),
  };
}

const pathOf = (model: string, rig?: string) =>
  rig === 'meshy' ? `public/assets/meshy/${model}.glb` : `public/assets/kaykit/characters/${model}.glb`;

describe('every class model can play everything its kit asks for', () => {
  for (const cls of CLASSES) {
    const { model, rig: rigId, idle, move } = cls.visual;
    const rig = rigOf(rigId);
    const { clips, nodes } = glbInfo(pathOf(model, rigId));
    const resolves = (name: string) => clips.has(name) || clips.has(rig.aliases[name] ?? '');

    it(`${cls.id}: locomotion, dodges, hit and death clips`, () => {
      const core = [idle, move, 'Walking_Backwards', 'Running_Strafe_Left', 'Running_Strafe_Right', 'Jump_Idle',
        'Dodge_Forward', 'Dodge_Backward', 'Dodge_Left', 'Dodge_Right', 'Hit_A', 'Death_A'];
      expect(core.filter((c) => !resolves(c))).toEqual([]);
      for (const w of cls.weapons) if (w.idle) expect(resolves(w.idle), `${w.id} idle ${w.idle}`).toBe(true);
    });

    it(`${cls.id}: every weapon and utility skill has a clip`, () => {
      const skills = [...cls.weapons.flatMap((w) => w.skills), ...cls.utilities];
      const missing = skills.filter((s) => s.anim && ![s.anim].flat().some(resolves)).map((s) => `${s.id}:${s.anim}`);
      expect(missing).toEqual([]);
    });

    it(`${cls.id}: every weapon's props exist on the model`, () => {
      for (const w of cls.weapons) expect(w.keep.filter((p) => !nodes.has(p)), w.id).toEqual([]);
    });
  }
});
