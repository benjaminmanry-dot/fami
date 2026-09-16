import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyScene } from '../lib/classifier.js';

const falseCombat = [
  "Last week's battle with the lich nearly killed us.",
  'We are not in combat.',
  'OOC rules question: does this attack roll have advantage?',
  'The letter reads, “I will kill you before the next moon.”'
];

for (const phrase of falseCombat) {
  test(`does not turn reported/meta language into combat: ${phrase}`, () => {
    const result = classifyScene(phrase);
    assert.notEqual(result.scene, 'combat');
    assert.equal(result.force, false);
    assert.equal(result.suppressed, true);
  });
}

test('roll initiative is an immediate active-combat cue', () => {
  const result = classifyScene('Roll initiative. The hobgoblins charge!');
  assert.equal(result.scene, 'combat');
  assert.equal(result.force, true);
  assert.ok(result.confidence >= 0.95);
});

test('negated, conditional, historical, and depicted combat language holds the scene', () => {
  for (const text of [
    'Do not roll initiative yet; we are still talking.',
    'If you attack the guards, roll initiative.',
    'Swords are drawn on the banner above the puppet stage.',
    'Last session the fight ended and we took a short break.'
  ]) {
    const result = classifyScene(text);
    assert.equal(result.scene, null, text);
    assert.equal(result.force, false, text);
    assert.equal(result.suppressed, true, text);
  }

  const active = classifyScene('Okay, roll initiative.');
  assert.equal(active.scene, 'combat');
  assert.equal(active.force, true);
});

test('measured local-ASR homophone “role initiative” remains an immediate cue', () => {
  const result = classifyScene('Role Initiative The Hobgoblins Charge');
  assert.equal(result.scene, 'combat');
  assert.equal(result.force, true);
});

test('explicit scene ending returns to quiet immediately', () => {
  const result = classifyScene('The scene ends. Fade out.');
  assert.equal(result.scene, 'quiet');
  assert.equal(result.force, true);
});

test('ordinary scene language produces useful categories without forcing', () => {
  assert.equal(classifyScene('We travel along the mountain road toward the valley.').scene, 'travel');
  assert.equal(classifyScene('The party settles beside a warm campfire for a long rest.').scene, 'rest');
  assert.equal(classifyScene('A hidden ritual symbol is the only clue.').scene, 'mystery');
  assert.equal(classifyScene('The trap closes and something hostile is approaching.').scene, 'danger');
});

test('silence carries no scene instruction', () => {
  const result = classifyScene('   ');
  assert.equal(result.scene, null);
  assert.equal(result.reason, 'silence');
});
