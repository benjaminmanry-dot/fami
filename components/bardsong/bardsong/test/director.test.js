import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneDirector } from '../lib/director.js';

test('ordinary cues must persist before the scene changes', () => {
  const director = new SceneDirector({ minConsecutive: 2, minDwellMs: 8_000 });
  const first = director.ingest('We journey down the old road.', 1_000);
  assert.equal(first.changed, false);
  assert.equal(first.state.candidateScene, 'travel');
  const second = director.ingest('The caravan travels into the forest.', 2_000);
  assert.equal(second.changed, true);
  assert.equal(second.state.currentScene, 'travel');
});

test('explicit combat bypasses the stability delay', () => {
  const director = new SceneDirector();
  const result = director.ingest('Roll initiative!', 1_000);
  assert.equal(result.changed, true);
  assert.equal(result.state.currentScene, 'combat');
});

test('false combat, silence, and rapid alternating cues hold the current scene', () => {
  const director = new SceneDirector({ minConsecutive: 2, minDwellMs: 8_000 });
  director.ingest('Roll initiative!', 1_000);
  director.ingest("Last week's battle was terrifying.", 10_000);
  director.ingest('', 11_000);
  director.ingest('A dangerous trap is closing in.', 12_000);
  director.ingest('We travel along a forest road.', 13_000);
  director.ingest('A hostile pursuer approaches.', 14_000);
  director.ingest('The caravan continues its journey.', 15_000);
  assert.equal(director.currentScene, 'combat');
});

test('manual override holds until explicit resume', () => {
  const director = new SceneDirector({ minConsecutive: 2, minDwellMs: 0 });
  director.override('rest', 1_000);
  assert.equal(director.held, true);
  director.ingest('Roll initiative!', 2_000);
  assert.equal(director.currentScene, 'rest');
  director.resume();
  director.ingest('Roll initiative!', 3_000);
  assert.equal(director.currentScene, 'combat');
});

test('scene endings and stop are immediate', () => {
  const director = new SceneDirector();
  director.ingest('Roll initiative!', 1_000);
  assert.equal(director.ingest('The fight ends and the scene is over.', 2_000).state.currentScene, 'quiet');
  director.stop();
  assert.equal(director.active, false);
  director.ingest('Roll initiative!', 3_000);
  assert.equal(director.currentScene, 'quiet');
});
