export const SCENES = Object.freeze([
  { id: 'quiet', label: 'Quiet', note: 'Silence, pauses, and scene endings' },
  { id: 'rest', label: 'Rest', note: 'Campfires, sanctuary, and recovery' },
  { id: 'travel', label: 'Travel', note: 'Roads, wilderness, and exploration' },
  { id: 'social', label: 'Social', note: 'Taverns, markets, and conversation' },
  { id: 'mystery', label: 'Mystery', note: 'Investigation, secrets, and discovery' },
  { id: 'danger', label: 'Danger', note: 'Threats, pursuit, and rising tension' },
  { id: 'combat', label: 'Combat', note: 'Active battles only' },
  { id: 'wonder', label: 'Wonder', note: 'Magic, awe, and revelation' },
  { id: 'sorrow', label: 'Sorrow', note: 'Loss, reflection, and aftermath' },
  { id: 'victory', label: 'Victory', note: 'Triumph and celebration' }
]);

export const SCENE_IDS = Object.freeze(SCENES.map((scene) => scene.id));

export function isScene(value) {
  return SCENE_IDS.includes(value);
}
