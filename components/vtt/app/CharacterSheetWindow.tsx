"use client";

import {
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  abilityKeys,
  type CharacterSheet,
  createOfficialSheetLayout,
  importCharacterSheet,
  type RichTextRun,
  skillDefinitions,
  type SheetAttack,
  type SheetInkStroke,
  type SheetInventoryItem,
  type SheetModuleId,
  type SheetModuleLayout,
  type SheetResource,
  type SheetSpell,
  splitGoldPieces,
} from "@/lib/character-sheet";
import { TokenMaker } from "@/app/TokenMaker";
import type { CharacterCreatorDraft } from "@/lib/character-creator";

type WindowRect = { x: number; y: number; width: number; height: number };
type WindowDrag = { pointerId: number; startX: number; startY: number; x: number; y: number };
const CharacterCreator = lazy(() => import("@/app/CharacterCreator").then((module) => ({ default: module.CharacterCreator })));

const moduleTitles: Record<SheetModuleId, string> = {
  identity: "Character",
  vitals: "Combat & survival",
  abilities: "Ability scores & saves",
  skills: "Skills",
  attacks: "Weapons & damage cantrips",
  features: "Class features & training",
  resources: "Resources",
  inventory: "Equipment",
  spells: "Cantrips & prepared spells",
  currency: "Coins & loot",
  notes: "Appearance, story & languages",
};

export function CharacterSheetWindow({
  sheet,
  tokenImageUrl,
  onChange,
  onTokenImage,
  onRoll,
  onClose,
}: {
  sheet: CharacterSheet;
  tokenImageUrl: string | null;
  onChange(sheet: CharacterSheet): Promise<boolean> | boolean | void;
  onTokenImage(file: File): Promise<void>;
  onRoll(formula: string): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(sheet);
  const draftRef = useRef(sheet);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [inkMode, setInkMode] = useState(false);
  const [inkColor, setInkColor] = useState("#b3266e");
  const [activeStroke, setActiveStroke] = useState<SheetInkStroke | null>(null);
  const activeStrokeRef = useRef<SheetInkStroke | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const windowRef = useRef<HTMLElement | null>(null);
  const windowDragRef = useRef<WindowDrag | null>(null);
  const draggedModuleRef = useRef<SheetModuleId | null>(null);
  const [inventoryFilter, setInventoryFilter] = useState("");
  const [lootGold, setLootGold] = useState(0);
  const [lootPlayers, setLootPlayers] = useState(1);
  const [message, setMessage] = useState("");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [tokenMakerOpen, setTokenMakerOpen] = useState(false);
  const [windowRect, setWindowRect] = useState<WindowRect>({
    x: 120,
    y: 78,
    width: 1040,
    height: 760,
  });

  useEffect(() => {
    const saved = localStorage.getItem(`vtt:sheet-window:${sheet.id}`);
    if (!saved) return;
    try {
      const rect = JSON.parse(saved) as Partial<WindowRect>;
      queueMicrotask(() => setWindowRect({
          x: bounded(rect.x, -900, window.innerWidth - 160, 120),
          y: bounded(rect.y, 0, window.innerHeight - 70, 78),
          width: bounded(rect.width, 620, Math.max(620, window.innerWidth), 1040),
          height: bounded(rect.height, 480, Math.max(480, window.innerHeight), 760),
        }));
    } catch {
      localStorage.removeItem(`vtt:sheet-window:${sheet.id}`);
    }
  }, [sheet.id]);

  const split = useMemo(() => splitGoldPieces(lootGold, lootPlayers), [lootGold, lootPlayers]);
  const filteredInventory = draft.inventory.filter((item) =>
    `${item.name} ${item.category} ${item.notes}`.toLowerCase().includes(inventoryFilter.toLowerCase()),
  );

  function updateDraft(nextOrUpdater: CharacterSheet | ((current: CharacterSheet) => CharacterSheet)) {
    const next = typeof nextOrUpdater === "function"
      ? nextOrUpdater(draftRef.current)
      : nextOrUpdater;
    draftRef.current = next;
    setDraft(next);
    return next;
  }

  function persist(next: CharacterSheet) {
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const saved = await onChange(next);
        if (saved === false) setMessage("This sheet could not be saved. Try again.");
      });
  }

  function commit(next: CharacterSheet, notice = "") {
    updateDraft(next);
    persist(next);
    if (notice) setMessage(notice);
  }

  function saveDraft() {
    persist(draftRef.current);
  }

  function startWindowDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest("button, input, select, label")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    windowDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: windowRect.x,
      y: windowRect.y,
    };
  }

  function moveWindow(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = windowDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setWindowRect((rect) => ({
      ...rect,
      x: bounded(drag.x + event.clientX - drag.startX, -rect.width + 180, window.innerWidth - 180, rect.x),
      y: bounded(drag.y + event.clientY - drag.startY, 0, window.innerHeight - 52, rect.y),
    }));
  }

  function finishWindowDrag() {
    windowDragRef.current = null;
    saveWindowRect();
  }

  function saveWindowRect() {
    const element = windowRef.current;
    const rect = element?.getBoundingClientRect();
    const next = rect
      ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
      : windowRect;
    setWindowRect(next);
    localStorage.setItem(`vtt:sheet-window:${sheet.id}`, JSON.stringify(next));
  }

  function reorderModule(targetId: SheetModuleId) {
    const sourceId = draggedModuleRef.current;
    draggedModuleRef.current = null;
    if (!sourceId || sourceId === targetId) return;
    const modules = [...draft.modules];
    const sourceIndex = modules.findIndex((module) => module.id === sourceId);
    const targetIndex = modules.findIndex((module) => module.id === targetId);
    const [source] = modules.splice(sourceIndex, 1);
    modules.splice(targetIndex, 0, source);
    commit({ ...draft, modules });
  }

  function moveModule(id: SheetModuleId, direction: -1 | 1) {
    const modules = [...draft.modules];
    const index = modules.findIndex((module) => module.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= modules.length) return;
    [modules[index], modules[target]] = [modules[target], modules[index]];
    commit({ ...draft, modules });
  }

  function resizeModule(id: SheetModuleId, spanDelta: number, heightDelta: number) {
    commit({
      ...draft,
      modules: draft.modules.map((module) => module.id === id ? {
        ...module,
        span: bounded(module.span + spanDelta, 4, 12, module.span),
        height: bounded(module.height + heightDelta, 160, 720, module.height),
      } : module),
    });
  }

  async function importSheet(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1_000_000) throw new Error("Character files must be 1 MB or smaller.");
      const imported = importCharacterSheet(JSON.parse(await file.text()), draft);
      commit(imported, `Imported ${imported.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That character file could not be read.");
    } finally {
      input.value = "";
    }
  }

  function exportSheet() {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "character"}-sheet.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function applyCreator(build: CharacterCreatorDraft, confirmationFingerprint: string) {
    try {
      await saveQueueRef.current.catch(() => undefined);
      // The room snapshot is the authority while the creator is open. Using the
      // latest prop makes an edit from another client invalidate this review
      // instead of letting a stale local sheet silently overwrite it.
      const previous = sheet;
      const { applyCharacterCreatorDraft } = await import("@/lib/character-creator");
      const next = await applyCharacterCreatorDraft(previous, build, confirmationFingerprint);
      localStorage.setItem(`vtt:sheet-before-creator:${previous.id}`, JSON.stringify(previous));
      updateDraft(next);
      const saved = await onChange(next);
      if (saved === false) {
        updateDraft(previous);
        throw new Error("The native sheet rejected this update. The draft and previous sheet are preserved.");
      }
      setMessage(`${next.name} was applied. A device-local copy of the previous sheet is available from Restore pre-creator.`);
      setCreatorOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That character could not be applied.");
      throw error;
    }
  }

  async function restoreCreatorBackup() {
    const key = `vtt:sheet-before-creator:${draftRef.current.id}`;
    const saved = localStorage.getItem(key);
    if (!saved) {
      setMessage("No device-local pre-creator sheet is available.");
      return;
    }
    if (!window.confirm("Restore the sheet saved immediately before the last Character Creator apply? The current sheet will remain recoverable through your normal export and room history.")) return;
    try {
      await saveQueueRef.current.catch(() => undefined);
      const current = draftRef.current;
      const restored = importCharacterSheet(JSON.parse(saved), current);
      updateDraft(restored);
      const persisted = await onChange(restored);
      if (persisted === false) {
        updateDraft(current);
        throw new Error("The native sheet rejected the restore. The current sheet and pre-creator copy are still preserved.");
      }
      localStorage.setItem(key, JSON.stringify(current));
      setMessage(`Restored the pre-creator copy of ${restored.name}. The replaced sheet is now the recoverable copy.`);
    } catch {
      setMessage("The device-local pre-creator copy could not be restored. The current sheet was not changed.");
    }
  }

  function beginInk(event: ReactPointerEvent<SVGSVGElement>) {
    if (!inkMode || !contentRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke: SheetInkStroke = {
      id: `stroke-${crypto.randomUUID()}`,
      color: inkColor,
      width: 3,
      points: [inkPoint(event)],
    };
    activeStrokeRef.current = stroke;
    setActiveStroke(stroke);
  }

  function continueInk(event: ReactPointerEvent<SVGSVGElement>) {
    const stroke = activeStrokeRef.current;
    if (!stroke || !contentRef.current || stroke.points.length >= 500) return;
    const point = inkPoint(event);
    const previous = stroke.points[stroke.points.length - 1];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.002) return;
    const next = { ...stroke, points: [...stroke.points, point] };
    activeStrokeRef.current = next;
    setActiveStroke(next);
  }

  function finishInk() {
    const stroke = activeStrokeRef.current;
    activeStrokeRef.current = null;
    setActiveStroke(null);
    if (!stroke || stroke.points.length < 2) return;
    commit({ ...draft, strokes: [...draft.strokes, stroke].slice(-100) });
  }

  function inkPoint(event: ReactPointerEvent<SVGSVGElement>) {
    const rect = contentRef.current!.getBoundingClientRect();
    return {
      x: bounded((event.clientX - rect.left) / rect.width, 0, 1, 0),
      y: bounded((event.clientY - rect.top) / rect.height, 0, 1, 0),
    };
  }

  function updateAttack(id: string, patch: Partial<SheetAttack>) {
    updateDraft((current) => ({
      ...current,
      attacks: current.attacks.map((attack) => attack.id === id ? { ...attack, ...patch } : attack),
    }));
  }

  function updateResource(id: string, patch: Partial<SheetResource>, persist = false) {
    const next = {
      ...draft,
      resources: draft.resources.map((resource) => resource.id === id ? { ...resource, ...patch } : resource),
    };
    if (persist) commit(next);
    else updateDraft(next);
  }

  function updateItem(id: string, patch: Partial<SheetInventoryItem>, persist = false) {
    const next = {
      ...draft,
      inventory: draft.inventory.map((item) => item.id === id ? { ...item, ...patch } : item),
    };
    if (persist) commit(next);
    else updateDraft(next);
  }

  function updateAttunement(index: number, value: string) {
    const magicItemAttunement = [...draftRef.current.magicItemAttunement] as CharacterSheet["magicItemAttunement"];
    magicItemAttunement[index] = value;
    updateDraft({ ...draftRef.current, magicItemAttunement });
  }

  function updateSpell(id: string, patch: Partial<SheetSpell>, persist = false) {
    const next = {
      ...draftRef.current,
      spellcasting: {
        ...draftRef.current.spellcasting,
        spells: draftRef.current.spellcasting.spells.map((spell) => spell.id === id ? { ...spell, ...patch } : spell),
      },
    };
    if (persist) commit(next);
    else updateDraft(next);
  }

  function renderModule(layout: SheetModuleLayout) {
    const shared = {
      layout,
      locked: draft.layoutLocked,
      onDragStart: (event: DragEvent<HTMLButtonElement>) => {
        draggedModuleRef.current = layout.id;
        event.dataTransfer.effectAllowed = "move";
      },
      onDrop: () => reorderModule(layout.id),
      onMove: (direction: -1 | 1) => moveModule(layout.id, direction),
      onResize: (span: number, height: number) => resizeModule(layout.id, span, height),
    };

    switch (layout.id) {
      case "identity":
        return (
          <SheetModule key={layout.id} {...shared}>
            <div className="sheet-identity-grid">
              <label className="sheet-name-field">Character name<input value={draft.name} onChange={(event) => updateDraft({ ...draftRef.current, name: event.target.value })} onBlur={saveDraft} /></label>
              <label>Background<input value={draft.identity.background} onChange={(event) => updateDraft({ ...draftRef.current, identity: { ...draftRef.current.identity, background: event.target.value } })} onBlur={saveDraft} /></label>
              <label>Class<input value={draft.identity.className} onChange={(event) => updateDraft({ ...draftRef.current, identity: { ...draftRef.current.identity, className: event.target.value } })} onBlur={saveDraft} /></label>
              <label>Species<input value={draft.identity.species} onChange={(event) => updateDraft({ ...draftRef.current, identity: { ...draftRef.current.identity, species: event.target.value } })} onBlur={saveDraft} /></label>
              <label>Subclass<input value={draft.identity.subclass} onChange={(event) => updateDraft({ ...draftRef.current, identity: { ...draftRef.current.identity, subclass: event.target.value } })} onBlur={saveDraft} /></label>
              <label>Level<input type="number" min="1" max="30" value={draft.identity.level} onChange={(event) => updateDraft({ ...draftRef.current, identity: { ...draftRef.current.identity, level: Number(event.target.value) } })} onBlur={saveDraft} /></label>
              <label>XP<input type="number" min="0" value={draft.identity.xp} onChange={(event) => updateDraft({ ...draftRef.current, identity: { ...draftRef.current.identity, xp: Number(event.target.value) } })} onBlur={saveDraft} /></label>
              <label>Alignment<input value={draft.identity.alignment} onChange={(event) => updateDraft({ ...draftRef.current, identity: { ...draftRef.current.identity, alignment: event.target.value } })} onBlur={saveDraft} /></label>
            </div>
          </SheetModule>
        );

      case "vitals":
        return (
          <SheetModule key={layout.id} {...shared}>
            <div className="sheet-vitals-grid">
              <VitalField label="Armor class" value={draft.vitals.armorClass} onValue={(value) => updateDraft({ ...draftRef.current, vitals: { ...draftRef.current.vitals, armorClass: value } })} onSave={saveDraft} />
              <VitalField label="Shield" value={draft.vitals.shieldBonus} signed onValue={(value) => updateDraft({ ...draftRef.current, vitals: { ...draftRef.current.vitals, shieldBonus: value } })} onSave={saveDraft} />
              <VitalField label="Initiative" value={draft.vitals.initiative} signed onValue={(value) => updateDraft({ ...draftRef.current, vitals: { ...draftRef.current.vitals, initiative: value } })} onSave={saveDraft} />
              <VitalField label="Speed" value={draft.vitals.speed} suffix="ft" onValue={(value) => updateDraft({ ...draftRef.current, vitals: { ...draftRef.current.vitals, speed: value } })} onSave={saveDraft} />
              <VitalField label="Proficiency" value={draft.vitals.proficiency} signed onValue={(value) => updateDraft({ ...draftRef.current, vitals: { ...draftRef.current.vitals, proficiency: value } })} onSave={saveDraft} />
              <label className="sheet-vital"><span>Size</span><input value={draft.vitals.size} onChange={(event) => updateDraft({ ...draftRef.current, vitals: { ...draftRef.current.vitals, size: event.target.value } })} onBlur={saveDraft} /></label>
              <div className="sheet-hp-field">
                <span>Hit points</span>
                <div><input aria-label="Current hit points" type="number" value={draft.vitals.hpCurrent} onChange={(event) => updateDraft({ ...draftRef.current, vitals: { ...draftRef.current.vitals, hpCurrent: Number(event.target.value) } })} onBlur={saveDraft} /><b>/</b><input aria-label="Maximum hit points" type="number" min="0" value={draft.vitals.hpMax} onChange={(event) => updateDraft({ ...draftRef.current, vitals: { ...draftRef.current.vitals, hpMax: Number(event.target.value) } })} onBlur={saveDraft} /></div>
                <small>Temporary <input aria-label="Temporary hit points" type="number" min="0" value={draft.vitals.tempHp} onChange={(event) => updateDraft({ ...draftRef.current, vitals: { ...draftRef.current.vitals, tempHp: Number(event.target.value) } })} onBlur={saveDraft} /></small>
              </div>
              <div className="sheet-hp-field sheet-hit-dice">
                <span>Hit dice</span>
                <div><input aria-label="Hit die" value={draft.vitals.hitDie} onChange={(event) => updateDraft({ ...draftRef.current, vitals: { ...draftRef.current.vitals, hitDie: event.target.value } })} onBlur={saveDraft} /><input aria-label="Hit dice spent" type="number" min="0" max={draft.vitals.hitDiceMax} value={draft.vitals.hitDiceSpent} onChange={(event) => updateDraft({ ...draftRef.current, vitals: { ...draftRef.current.vitals, hitDiceSpent: Number(event.target.value) } })} onBlur={saveDraft} /><b>/</b><input aria-label="Maximum hit dice" type="number" min="0" value={draft.vitals.hitDiceMax} onChange={(event) => updateDraft({ ...draftRef.current, vitals: { ...draftRef.current.vitals, hitDiceMax: Number(event.target.value) } })} onBlur={saveDraft} /></div>
                <small>Die · spent / max</small>
              </div>
              <div className="sheet-hp-field sheet-death-saves">
                <span>Death saves</span>
                <div><label>Successes<input aria-label="Death save successes" type="number" min="0" max="3" value={draft.vitals.deathSaveSuccesses} onChange={(event) => updateDraft({ ...draftRef.current, vitals: { ...draftRef.current.vitals, deathSaveSuccesses: Number(event.target.value) } })} onBlur={saveDraft} /></label><label>Failures<input aria-label="Death save failures" type="number" min="0" max="3" value={draft.vitals.deathSaveFailures} onChange={(event) => updateDraft({ ...draftRef.current, vitals: { ...draftRef.current.vitals, deathSaveFailures: Number(event.target.value) } })} onBlur={saveDraft} /></label></div>
              </div>
              <label className="sheet-vital sheet-inspiration"><span>Heroic inspiration</span><input type="checkbox" checked={draft.vitals.heroicInspiration} onChange={(event) => commit({ ...draftRef.current, vitals: { ...draftRef.current.vitals, heroicInspiration: event.target.checked } })} /><strong>{draft.vitals.heroicInspiration ? "Ready" : "Open"}</strong></label>
              <div className="passive-score-card">
                <span>Passive <input aria-label="Passive skill name" value={draft.passive.label} onChange={(event) => updateDraft({ ...draftRef.current, passive: { ...draftRef.current.passive, label: event.target.value } })} onBlur={saveDraft} /></span>
                <strong>{10 + draft.passive.bonus}</strong>
                <small>10 + your {draft.passive.label || "skill"} bonus (<input aria-label="Passive skill bonus" type="number" value={draft.passive.bonus} onChange={(event) => updateDraft({ ...draftRef.current, passive: { ...draftRef.current.passive, bonus: Number(event.target.value) } })} onBlur={saveDraft} />)</small>
              </div>
            </div>
          </SheetModule>
        );

      case "abilities":
        return (
          <SheetModule key={layout.id} {...shared}>
            <div className="sheet-abilities-grid">
              {abilityKeys.map((key) => {
                const ability = draft.abilities[key];
                const modifier = Math.floor((ability.score - 10) / 2);
                return (
                  <div className="sheet-ability" key={key}>
                    <span>{ability.label}</span>
                    <div><input aria-label={`${ability.label} score`} type="number" min="1" max="30" value={ability.score} onChange={(event) => updateDraft({ ...draftRef.current, abilities: { ...draftRef.current.abilities, [key]: { ...ability, score: Number(event.target.value) } } })} onBlur={saveDraft} /><strong>{signed(modifier)}</strong></div>
                    <label><input type="checkbox" checked={ability.proficient} onChange={(event) => commit({ ...draft, abilities: { ...draft.abilities, [key]: { ...ability, proficient: event.target.checked } } })} /> Save <input aria-label={`${ability.label} save`} type="number" value={ability.save} onChange={(event) => updateDraft({ ...draftRef.current, abilities: { ...draftRef.current.abilities, [key]: { ...ability, save: Number(event.target.value) } } })} onBlur={saveDraft} /></label>
                    <button onClick={() => onRoll(d20(modifier))}>Roll check</button>
                  </div>
                );
              })}
            </div>
          </SheetModule>
        );

      case "skills":
        return (
          <SheetModule key={layout.id} {...shared}>
            <div className="sheet-skills-grid">
              {skillDefinitions.map((definition) => {
                const skill = draft.skills[definition.id];
                return (
                  <div className="sheet-skill" key={definition.id}>
                    <label><input type="checkbox" checked={skill.proficient} onChange={(event) => commit({ ...draftRef.current, skills: { ...draftRef.current.skills, [definition.id]: { ...skill, proficient: event.target.checked } } })} /><span>{definition.label}<small>{definition.ability.toUpperCase()}</small></span></label>
                    <input aria-label={`${definition.label} bonus`} type="number" value={skill.bonus} onChange={(event) => updateDraft({ ...draftRef.current, skills: { ...draftRef.current.skills, [definition.id]: { ...skill, bonus: Number(event.target.value) } } })} onBlur={saveDraft} />
                    <button onClick={() => onRoll(d20(skill.bonus))}>Roll</button>
                  </div>
                );
              })}
            </div>
          </SheetModule>
        );

      case "attacks":
        return (
          <SheetModule key={layout.id} {...shared} action={<button onClick={() => commit({ ...draft, attacks: [...draft.attacks, newAttack()] })}>Add attack</button>}>
            <div className="sheet-list">
              {!draft.attacks.length && <EmptyModule text="Add the attacks you actually use at the table." />}
              {draft.attacks.map((attack) => (
                <div className="attack-row" key={attack.id}>
                  <input className="wide-name" aria-label="Attack name" value={attack.name} onChange={(event) => updateAttack(attack.id, { name: event.target.value })} onBlur={saveDraft} />
                  <label>Attack / DC<input type="number" value={attack.attackBonus} onChange={(event) => updateAttack(attack.id, { attackBonus: Number(event.target.value) })} onBlur={saveDraft} /></label>
                  <label>Damage<input value={attack.damage} onChange={(event) => updateAttack(attack.id, { damage: event.target.value })} onBlur={saveDraft} /></label>
                  <input aria-label="Damage type" value={attack.damageType} onChange={(event) => updateAttack(attack.id, { damageType: event.target.value })} onBlur={saveDraft} />
                  <textarea aria-label="Attack notes" value={attack.notes} placeholder="Notes" onChange={(event) => updateAttack(attack.id, { notes: event.target.value })} onBlur={saveDraft} />
                  <div className="row-actions"><button onClick={() => onRoll(d20(attack.attackBonus))}>Attack</button><button onClick={() => onRoll(attack.damage)}>Damage</button><button aria-label={`Remove ${attack.name}`} onClick={() => commit({ ...draft, attacks: draft.attacks.filter((candidate) => candidate.id !== attack.id) })}>×</button></div>
                </div>
              ))}
            </div>
          </SheetModule>
        );

      case "features":
        return (
          <SheetModule key={layout.id} {...shared}>
            <div className="sheet-features-grid">
              <label>Class features<textarea value={draft.details.classFeatures} onChange={(event) => updateDraft({ ...draftRef.current, details: { ...draftRef.current.details, classFeatures: event.target.value } })} onBlur={saveDraft} /></label>
              <label>Species traits<textarea value={draft.details.speciesTraits} onChange={(event) => updateDraft({ ...draftRef.current, details: { ...draftRef.current.details, speciesTraits: event.target.value } })} onBlur={saveDraft} /></label>
              <label>Feats<textarea value={draft.details.feats} onChange={(event) => updateDraft({ ...draftRef.current, details: { ...draftRef.current.details, feats: event.target.value } })} onBlur={saveDraft} /></label>
              <fieldset className="armor-training"><legend>Armor training</legend>{(["light", "medium", "heavy", "shields"] as const).map((kind) => <label key={kind}><input type="checkbox" checked={draft.details.armorTraining[kind]} onChange={(event) => commit({ ...draftRef.current, details: { ...draftRef.current.details, armorTraining: { ...draftRef.current.details.armorTraining, [kind]: event.target.checked } } })} /> {kind[0].toUpperCase() + kind.slice(1)}</label>)}</fieldset>
              <label>Weapon proficiencies<textarea value={draft.details.weapons} onChange={(event) => updateDraft({ ...draftRef.current, details: { ...draftRef.current.details, weapons: event.target.value } })} onBlur={saveDraft} /></label>
              <label>Tool proficiencies<textarea value={draft.details.tools} onChange={(event) => updateDraft({ ...draftRef.current, details: { ...draftRef.current.details, tools: event.target.value } })} onBlur={saveDraft} /></label>
            </div>
          </SheetModule>
        );

      case "resources":
        return (
          <SheetModule key={layout.id} {...shared} action={<button onClick={() => commit({ ...draft, resources: [...draft.resources, newResource()] })}>Add resource</button>}>
            <div className="sheet-list">
              {!draft.resources.length && <EmptyModule text="Track rages, spell slots, luck points, or anything else." />}
              {draft.resources.map((resource) => (
                <div className="resource-sheet-row" key={resource.id}>
                  <input className="wide-name" aria-label="Resource name" value={resource.name} onChange={(event) => updateResource(resource.id, { name: event.target.value })} onBlur={saveDraft} />
                  <div className="resource-sheet-stepper"><button onClick={() => updateResource(resource.id, { current: Math.max(0, resource.current - 1) }, true)}>−</button><input aria-label={`${resource.name} current`} type="number" min="0" value={resource.current} onChange={(event) => updateResource(resource.id, { current: Number(event.target.value) })} onBlur={saveDraft} /><span>/</span><input aria-label={`${resource.name} maximum`} type="number" min="0" value={resource.max} onChange={(event) => updateResource(resource.id, { max: Number(event.target.value) })} onBlur={saveDraft} /><button onClick={() => updateResource(resource.id, { current: Math.min(resource.max, resource.current + 1) }, true)}>+</button></div>
                  <input aria-label={`${resource.name} reset`} value={resource.reset} placeholder="Long rest" onChange={(event) => updateResource(resource.id, { reset: event.target.value })} onBlur={saveDraft} />
                  <button aria-label={`Remove ${resource.name}`} onClick={() => commit({ ...draft, resources: draft.resources.filter((candidate) => candidate.id !== resource.id) })}>×</button>
                </div>
              ))}
            </div>
          </SheetModule>
        );

      case "inventory":
        return (
          <SheetModule key={layout.id} {...shared} action={<button onClick={() => commit({ ...draft, inventory: [...draft.inventory, newItem()] })}>Add item</button>}>
            <div className="inventory-summary"><input type="search" value={inventoryFilter} placeholder="Filter inventory" aria-label="Filter inventory" onChange={(event) => setInventoryFilter(event.target.value)} /><span>{draft.inventory.reduce((sum, item) => sum + item.quantity * item.weight, 0).toFixed(1)} lb · {draft.inventory.length} entries</span></div>
            <div className="sheet-list inventory-sheet-list">
              {!filteredInventory.length && <EmptyModule text={draft.inventory.length ? "No items match that filter." : "Add gear without fighting a cramped spreadsheet."} />}
              {filteredInventory.map((item) => (
                <div className="inventory-sheet-row" key={item.id}>
                  <label className="equip-check"><input type="checkbox" checked={item.equipped} onChange={(event) => updateItem(item.id, { equipped: event.target.checked }, true)} /> Equipped</label>
                  <input className="wide-name" aria-label="Item name" value={item.name} onChange={(event) => updateItem(item.id, { name: event.target.value })} onBlur={saveDraft} />
                  <label>Qty<input type="number" min="0" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: Number(event.target.value) })} onBlur={saveDraft} /></label>
                  <label>Weight<input type="number" min="0" step="0.1" value={item.weight} onChange={(event) => updateItem(item.id, { weight: Number(event.target.value) })} onBlur={saveDraft} /></label>
                  <input aria-label="Item category" value={item.category} onChange={(event) => updateItem(item.id, { category: event.target.value })} onBlur={saveDraft} />
                  <textarea aria-label={`${item.name} notes`} value={item.notes} placeholder="Notes, properties, charges…" onChange={(event) => updateItem(item.id, { notes: event.target.value })} onBlur={saveDraft} />
                  <button aria-label={`Remove ${item.name}`} onClick={() => commit({ ...draft, inventory: draft.inventory.filter((candidate) => candidate.id !== item.id) })}>×</button>
                </div>
              ))}
            </div>
            <div className="attunement-grid"><strong>Magic item attunement</strong>{draft.magicItemAttunement.map((item, index) => <input key={index} aria-label={`Attuned magic item ${index + 1}`} value={item} placeholder={`Attuned item ${index + 1}`} onChange={(event) => updateAttunement(index, event.target.value)} onBlur={saveDraft} />)}</div>
          </SheetModule>
        );

      case "spells":
        return (
          <SheetModule key={layout.id} {...shared} action={<button onClick={() => commit({ ...draftRef.current, spellcasting: { ...draftRef.current.spellcasting, spells: [...draftRef.current.spellcasting.spells, newSpell()] } })}>Add spell</button>}>
            <div className="spellcasting-summary">
              <label>Spellcasting ability<input value={draft.spellcasting.ability} onChange={(event) => updateDraft({ ...draftRef.current, spellcasting: { ...draftRef.current.spellcasting, ability: event.target.value } })} onBlur={saveDraft} /></label>
              <label>Modifier<input type="number" value={draft.spellcasting.modifier} onChange={(event) => updateDraft({ ...draftRef.current, spellcasting: { ...draftRef.current.spellcasting, modifier: Number(event.target.value) } })} onBlur={saveDraft} /></label>
              <label>Spell save DC<input type="number" min="0" value={draft.spellcasting.saveDc} onChange={(event) => updateDraft({ ...draftRef.current, spellcasting: { ...draftRef.current.spellcasting, saveDc: Number(event.target.value) } })} onBlur={saveDraft} /></label>
              <label>Spell attack bonus<input type="number" value={draft.spellcasting.attackBonus} onChange={(event) => updateDraft({ ...draftRef.current, spellcasting: { ...draftRef.current.spellcasting, attackBonus: Number(event.target.value) } })} onBlur={saveDraft} /></label>
            </div>
            {(draft.spellcasting.profiles?.length ?? 0) > 1 && <div className="casting-profile-grid" aria-label="Creator casting profiles">
              {draft.spellcasting.profiles!.map((profile) => <div key={`${profile.className}:${profile.ability}`}><b>{profile.className}</b><span>{profile.ability.toUpperCase()} · DC {profile.saveDc} · attack {profile.attackBonus >= 0 ? "+" : ""}{profile.attackBonus}</span></div>)}
            </div>}
            <div className="spell-slot-grid">
              {draft.spellcasting.slots.map((slot, index) => <label key={slot.level}>Level {slot.level}<span><input aria-label={`Level ${slot.level} spell slots total`} type="number" min="0" value={slot.total} onChange={(event) => updateDraft({ ...draftRef.current, spellcasting: { ...draftRef.current.spellcasting, slots: draftRef.current.spellcasting.slots.map((candidate, slotIndex) => slotIndex === index ? { ...candidate, total: Number(event.target.value) } : candidate) } })} onBlur={saveDraft} /><b>total</b><input aria-label={`Level ${slot.level} spell slots expended`} type="number" min="0" value={slot.expended} onChange={(event) => updateDraft({ ...draftRef.current, spellcasting: { ...draftRef.current.spellcasting, slots: draftRef.current.spellcasting.slots.map((candidate, slotIndex) => slotIndex === index ? { ...candidate, expended: Number(event.target.value) } : candidate) } })} onBlur={saveDraft} /><b>used</b></span></label>)}
            </div>
            <div className="sheet-list spell-list">
              {!draft.spellcasting.spells.length && <EmptyModule text="Add cantrips and prepared spells when this character uses magic." />}
              {draft.spellcasting.spells.map((spell) => <div className="spell-row" key={spell.id}>
                <label>Level<input type="number" min="0" max="9" value={spell.level} onChange={(event) => updateSpell(spell.id, { level: Number(event.target.value) })} onBlur={saveDraft} /></label>
                <input className="wide-name" aria-label="Spell name" value={spell.name} onChange={(event) => updateSpell(spell.id, { name: event.target.value })} onBlur={saveDraft} />
                <label className="spell-check"><input type="checkbox" checked={spell.prepared !== false} onChange={(event) => updateSpell(spell.id, { prepared: event.target.checked }, true)} /> {spell.level === 0 ? "Known" : "Prepared"}</label>
                <input aria-label={`${spell.name} casting time`} value={spell.castingTime} placeholder="Casting time" onChange={(event) => updateSpell(spell.id, { castingTime: event.target.value })} onBlur={saveDraft} />
                <input aria-label={`${spell.name} range`} value={spell.range} placeholder="Range" onChange={(event) => updateSpell(spell.id, { range: event.target.value })} onBlur={saveDraft} />
                <label className="spell-check"><input type="checkbox" checked={spell.concentration} onChange={(event) => updateSpell(spell.id, { concentration: event.target.checked }, true)} /> Concentration</label>
                <label className="spell-check"><input type="checkbox" checked={spell.ritual} onChange={(event) => updateSpell(spell.id, { ritual: event.target.checked }, true)} /> Ritual</label>
                <input aria-label={`${spell.name} required material`} value={spell.material} placeholder="Required material" onChange={(event) => updateSpell(spell.id, { material: event.target.value })} onBlur={saveDraft} />
                <textarea aria-label={`${spell.name} notes`} value={spell.notes} placeholder="Spell notes" onChange={(event) => updateSpell(spell.id, { notes: event.target.value })} onBlur={saveDraft} />
                <button aria-label={`Remove ${spell.name}`} onClick={() => commit({ ...draftRef.current, spellcasting: { ...draftRef.current.spellcasting, spells: draftRef.current.spellcasting.spells.filter((candidate) => candidate.id !== spell.id) } })}>×</button>
              </div>)}
            </div>
          </SheetModule>
        );

      case "currency":
        return (
          <SheetModule key={layout.id} {...shared}>
            <div className="coin-grid">
              {(Object.keys(draft.coins) as Array<keyof CharacterSheet["coins"]>).map((coin) => (
                <label key={coin}>{coin.toUpperCase()}<input type="number" min="0" value={draft.coins[coin]} onChange={(event) => updateDraft({ ...draftRef.current, coins: { ...draftRef.current.coins, [coin]: Number(event.target.value) } })} onBlur={saveDraft} /></label>
              ))}
            </div>
            <div className="gold-calculator">
              <label>Loot in gold<input type="number" min="0" step="0.01" value={lootGold} onChange={(event) => setLootGold(Number(event.target.value))} /></label>
              <label>Split between<select value={lootPlayers} onChange={(event) => setLootPlayers(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} {count === 1 ? "player" : "players"}</option>)}</select></label>
              <div><span>Each gets</span><strong>{split.gp} gp · {split.sp} sp · {split.cp} cp</strong>{split.remainderCp > 0 && <small>{split.remainderCp} cp remains</small>}</div>
              <button onClick={() => commit({ ...draft, coins: { ...draft.coins, gp: draft.coins.gp + split.gp, sp: draft.coins.sp + split.sp, cp: draft.coins.cp + split.cp } }, "Added this character's share.")}>Add my share</button>
            </div>
          </SheetModule>
        );

      case "notes":
        return (
          <SheetModule key={layout.id} {...shared}>
            <div className="story-grid">
              <label>Appearance<textarea value={draft.story.appearance} onChange={(event) => updateDraft({ ...draftRef.current, story: { ...draftRef.current.story, appearance: event.target.value } })} onBlur={saveDraft} /></label>
              <label>Backstory<textarea value={draft.story.backstory} onChange={(event) => updateDraft({ ...draftRef.current, story: { ...draftRef.current.story, backstory: event.target.value } })} onBlur={saveDraft} /></label>
              <label>Personality<textarea value={draft.story.personality} onChange={(event) => updateDraft({ ...draftRef.current, story: { ...draftRef.current.story, personality: event.target.value } })} onBlur={saveDraft} /></label>
              <label>Languages<textarea value={draft.story.languages} onChange={(event) => updateDraft({ ...draftRef.current, story: { ...draftRef.current.story, languages: event.target.value } })} onBlur={saveDraft} /></label>
            </div>
            <RichNotes runs={draft.notes} onSave={(notes) => commit({ ...draft, notes }, "Notes saved.")} />
          </SheetModule>
        );
    }
  }

  const style = {
    left: windowRect.x,
    top: windowRect.y,
    width: windowRect.width,
    height: windowRect.height,
    "--sheet-text-scale": draft.textScale,
  } as CSSProperties;

  return (
    <section
      ref={windowRef}
      className={`character-sheet-window theme-${draft.theme} ${inkMode ? "ink-active" : ""}`}
      style={style}
      aria-label={`${draft.name} character sheet`}
      onPointerUpCapture={saveWindowRect}
    >
      <header
        className="character-sheet-titlebar"
        onPointerDown={startWindowDrag}
        onPointerMove={moveWindow}
        onPointerUp={finishWindowDrag}
        onPointerCancel={finishWindowDrag}
      >
        <div className="sheet-identity">
          <span className="sheet-portrait" style={tokenImageUrl ? { backgroundImage: `url("${tokenImageUrl}")` } : undefined}>{!tokenImageUrl && initials(draft.name)}</span>
          <label><input value={draft.name} aria-label="Character name" onChange={(event) => updateDraft({ ...draftRef.current, name: event.target.value })} onBlur={saveDraft} /><input value={draft.subtitle} aria-label="Character description" onChange={(event) => updateDraft({ ...draftRef.current, subtitle: event.target.value })} onBlur={saveDraft} /></label>
        </div>
        <div className="sheet-window-actions">
          <span>Drag this bar anywhere</span>
          <button aria-label="Print character sheet" title="Print" onClick={() => window.print()}>Print</button>
          <button aria-label="Close character sheet" title="Close" onClick={onClose}>×</button>
        </div>
      </header>

      <nav className="character-sheet-toolbar" aria-label="Character sheet tools">
        <button className="sheet-builder-button" onClick={() => setCreatorOpen(true)}>Create or level character</button>
        <button onClick={restoreCreatorBackup}>Restore pre-creator</button>
        <button onClick={() => setTokenMakerOpen(true)}>Create portrait token</button>
        <button className={!draft.layoutLocked ? "active" : ""} aria-pressed={!draft.layoutLocked} onClick={() => commit({ ...draft, layoutLocked: !draft.layoutLocked })}>{draft.layoutLocked ? "Unlock layout" : "Lock layout"}</button>
        <button onClick={() => { if (window.confirm("Replace this custom module arrangement with the illustrated 2024-style layout?")) commit({ ...draft, modules: createOfficialSheetLayout(), layoutLocked: true }, "Illustrated layout restored."); }}>Reset layout</button>
        <button className={inkMode ? "active" : ""} aria-pressed={inkMode} onClick={() => setInkMode((value) => !value)}>Draw notes</button>
        {inkMode && <input type="color" value={inkColor} onChange={(event) => setInkColor(event.target.value)} aria-label="Ink color" />}
        {draft.strokes.length > 0 && <button onClick={() => { if (window.confirm("Clear every scribble from this sheet?")) commit({ ...draft, strokes: [] }); }}>Clear ink</button>}
        <label>Colors<select value={draft.theme} onChange={(event) => commit({ ...draft, theme: event.target.value as CharacterSheet["theme"] })}><option value="parchment">Illustrated parchment</option><option value="blue-gold">Blue & gold</option><option value="high-contrast">High contrast</option></select></label>
        <div className="text-size-control"><span>Text</span><button aria-label="Decrease sheet text size" onClick={() => commit({ ...draft, textScale: Math.max(0.85, Number((draft.textScale - 0.1).toFixed(2))) })}>A−</button><button aria-label="Increase sheet text size" onClick={() => commit({ ...draft, textScale: Math.min(1.4, Number((draft.textScale + 0.1).toFixed(2))) })}>A+</button></div>
        <label className="sheet-import">Import sheet JSON<input type="file" accept="application/json,.json" onChange={importSheet} /></label>
        <button onClick={exportSheet}>Export sheet JSON</button>
        <output aria-live="polite">{message}</output>
      </nav>

      <div className="character-sheet-scroll">
        <div ref={contentRef} className="character-sheet-content">
          <div className="sheet-module-grid">
            {draft.modules.map(renderModule)}
          </div>
          <svg
            className="sheet-ink-layer"
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            aria-label="Freehand sheet notes"
            onPointerDown={beginInk}
            onPointerMove={continueInk}
            onPointerUp={finishInk}
            onPointerCancel={finishInk}
          >
            {[...draft.strokes, ...(activeStroke ? [activeStroke] : [])].map((stroke) => (
              <polyline key={stroke.id} points={stroke.points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ")} fill="none" stroke={stroke.color} strokeWidth={stroke.width} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </svg>
        </div>
      </div>
      {creatorOpen && <Suspense fallback={<div className="character-builder-backdrop"><div className="creator-loading">Opening character creator…</div></div>}><CharacterCreator sheet={sheet} onApply={applyCreator} onClose={() => setCreatorOpen(false)} /></Suspense>}
      {tokenMakerOpen && <TokenMaker name={draft.name} onSave={onTokenImage} onClose={() => setTokenMakerOpen(false)} />}
    </section>
  );
}

function SheetModule({
  layout,
  locked,
  action,
  children,
  onDragStart,
  onDrop,
  onMove,
  onResize,
}: {
  layout: SheetModuleLayout;
  locked: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
  onDragStart(event: DragEvent<HTMLButtonElement>): void;
  onDrop(): void;
  onMove(direction: -1 | 1): void;
  onResize(span: number, height: number): void;
}) {
  return (
    <section
      className="sheet-module"
      data-module={layout.id}
      style={{ gridColumn: `span ${layout.span}`, height: layout.height }}
      onDragOver={(event) => { if (!locked) event.preventDefault(); }}
      onDrop={onDrop}
    >
      <header>
        <div><span>Character module</span><h2>{moduleTitles[layout.id]}</h2></div>
        <div className="sheet-module-actions">
          {action}
          {!locked && (
            <>
              <button draggable aria-label={`Drag ${moduleTitles[layout.id]}`} title="Drag module" onDragStart={onDragStart}>⋮⋮</button>
              <button aria-label={`Move ${moduleTitles[layout.id]} earlier`} onClick={() => onMove(-1)}>←</button>
              <button aria-label={`Move ${moduleTitles[layout.id]} later`} onClick={() => onMove(1)}>→</button>
              <button aria-label={`Make ${moduleTitles[layout.id]} narrower`} onClick={() => onResize(-2, 0)}>−W</button>
              <button aria-label={`Make ${moduleTitles[layout.id]} wider`} onClick={() => onResize(2, 0)}>+W</button>
              <button aria-label={`Make ${moduleTitles[layout.id]} shorter`} onClick={() => onResize(0, -40)}>−H</button>
              <button aria-label={`Make ${moduleTitles[layout.id]} taller`} onClick={() => onResize(0, 40)}>+H</button>
            </>
          )}
        </div>
      </header>
      <div className="sheet-module-body">{children}</div>
    </section>
  );
}

function VitalField({
  label,
  value,
  suffix,
  signed: showSign,
  onValue,
  onSave,
}: {
  label: string;
  value: number;
  suffix?: string;
  signed?: boolean;
  onValue(value: number): void;
  onSave(): void;
}) {
  return <label className="sheet-vital"><span>{label}</span><div><input type="number" value={value} onChange={(event) => onValue(Number(event.target.value))} onBlur={onSave} />{showSign && value >= 0 && <b>+</b>}{suffix && <b>{suffix}</b>}</div></label>;
}

function RichNotes({ runs, onSave }: { runs: RichTextRun[]; onSave(runs: RichTextRun[]): void }) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.replaceChildren(...runs.map((run) => {
      const span = document.createElement("span");
      span.textContent = run.text;
      if (run.bold) span.style.fontWeight = "700";
      if (run.italic) span.style.fontStyle = "italic";
      if (run.underline) span.style.textDecoration = "underline";
      return span;
    }));
  }, [runs]);

  function format(command: "bold" | "italic" | "underline") {
    editorRef.current?.focus();
    document.execCommand(command);
  }

  function shortcuts(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const command = event.key.toLowerCase();
    if (command !== "b" && command !== "i" && command !== "u") return;
    event.preventDefault();
    format(command === "b" ? "bold" : command === "i" ? "italic" : "underline");
  }

  function save() {
    if (editorRef.current) onSave(readRichText(editorRef.current));
  }

  return (
    <div className="rich-notes">
      <div className="rich-notes-toolbar" aria-label="Note formatting">
        <button aria-label="Bold selected text" onMouseDown={(event) => { event.preventDefault(); format("bold"); }}><b>B</b></button>
        <button aria-label="Italicize selected text" onMouseDown={(event) => { event.preventDefault(); format("italic"); }}><i>I</i></button>
        <button aria-label="Underline selected text" onMouseDown={(event) => { event.preventDefault(); format("underline"); }}><u>U</u></button>
        <span>Ctrl+B · Ctrl+I · Ctrl+U</span>
        <button onClick={save}>Save notes</button>
      </div>
      <div ref={editorRef} className="rich-notes-editor" contentEditable suppressContentEditableWarning onKeyDown={shortcuts} onBlur={save} aria-label="Character notes" />
    </div>
  );
}

function readRichText(root: HTMLElement): RichTextRun[] {
  const runs: RichTextRun[] = [];
  function visit(node: Node, style: Omit<RichTextRun, "text">) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) runs.push({ text, ...style });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName;
    const next = {
      ...style,
      ...(tag === "B" || tag === "STRONG" || node.style.fontWeight === "700" ? { bold: true as const } : {}),
      ...(tag === "I" || tag === "EM" || node.style.fontStyle === "italic" ? { italic: true as const } : {}),
      ...(tag === "U" || node.style.textDecoration.includes("underline") ? { underline: true as const } : {}),
    };
    if (tag === "BR") runs.push({ text: "\n", ...style });
    else node.childNodes.forEach((child) => visit(child, next));
    if ((tag === "DIV" || tag === "P") && node !== root.lastChild) runs.push({ text: "\n", ...style });
  }
  root.childNodes.forEach((node) => visit(node, {}));
  return runs.reduce<RichTextRun[]>((merged, run) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.bold === run.bold && previous.italic === run.italic && previous.underline === run.underline) {
      previous.text += run.text;
    } else merged.push(run);
    return merged;
  }, []).slice(0, 500);
}

function EmptyModule({ text }: { text: string }) {
  return <p className="sheet-empty">{text}</p>;
}

function newAttack(): SheetAttack {
  return { id: `attack-${crypto.randomUUID()}`, name: "New attack", attackBonus: 0, damage: "1d6", damageType: "Damage", notes: "" };
}

function newResource(): SheetResource {
  return { id: `resource-${crypto.randomUUID()}`, name: "New resource", current: 1, max: 1, reset: "Long rest" };
}

function newItem(): SheetInventoryItem {
  return { id: `item-${crypto.randomUUID()}`, name: "New item", quantity: 1, weight: 0, category: "Gear", equipped: false, notes: "" };
}

function newSpell(): SheetSpell {
  return { id: `spell-${crypto.randomUUID()}`, level: 0, name: "New spell", prepared: true, castingTime: "1 action", range: "Self", concentration: false, ritual: false, material: "", notes: "" };
}

function d20(modifier: number): string {
  return `1d20${modifier ? ` ${modifier > 0 ? "+" : "-"} ${Math.abs(modifier)}` : ""}`;
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
}

function bounded(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}
