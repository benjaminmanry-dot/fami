"use client";

import { useEffect, useMemo, useState } from "react";
import { characterCatalogue, catalogueBackground, catalogueClass, catalogueFeat, catalogueSpecies, type CatalogueEquipmentChoice } from "@/lib/character-catalogue";
import {
  availableFeatsForSlot,
  availableSpells,
  availableSpellsForDraft,
  buildCharacterCreatorReview,
  castingDetailsForDraft,
  createCharacterCreatorDraft,
  equipmentItemChoiceKey,
  featSlotsForDraft,
  expertiseCountForDraft,
  languageChoiceCountForDraft,
  manualChoiceRequirementsForDraft,
  optionRequirementsForDraft,
  pointBuyCost,
  rebaseCharacterCreatorDraft,
  reconcileCharacterCreatorDraft,
  restoreCharacterCreatorDraft,
  skillChoiceRequirementsForDraft,
  spellChoiceRequirementsForDraft,
  speciesMagicForDraft,
  toolChoiceRequirementsForDraft,
  validateCharacterCreatorDraft,
  type CharacterCreatorDraft,
  type CharacterCreatorReview,
  type CreatorSpellChoices,
} from "@/lib/character-creator";
import { abilityKeys, type AbilityKey, type CharacterSheet, skillDefinitions, type SkillId } from "@/lib/character-sheet";

const steps = ["Basics", "Abilities", "Proficiencies", "Features", "Spells", "Equipment", "Review"] as const;
type Step = (typeof steps)[number];
const abilityLabels: Record<AbilityKey, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

export function CharacterCreator({
  sheet,
  onApply,
  onClose,
}: {
  sheet: CharacterSheet;
  onApply(draft: CharacterCreatorDraft, confirmationFingerprint: string): Promise<void>;
  onClose(): void;
}) {
  const storageKey = `vtt:character-creator:${sheet.id}`;
  const [step, setStep] = useState<Step>("Basics");
  const [draft, setDraft] = useState(() => restoredDraft(storageKey, sheet));
  const [review, setReview] = useState<CharacterCreatorReview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [spellSearch, setSpellSearch] = useState("");
  const [notice, setNotice] = useState("Draft changes stay on this device until you apply them.");
  const [busy, setBusy] = useState(false);
  const issues = useMemo(() => validateCharacterCreatorDraft(draft), [draft]);
  const classes = draft.classLevels.map((row) => ({ row, data: catalogueClass(row.classId) }));
  const species = catalogueSpecies(draft.speciesId);
  const background = catalogueBackground(draft.backgroundId);
  const totalLevel = draft.classLevels.reduce((sum, row) => sum + Number(row.levels || 0), 0);
  const featSlots = featSlotsForDraft(draft);
  const optionRequirements = optionRequirementsForDraft(draft);
  const skillChoiceRequirements = skillChoiceRequirementsForDraft(draft);
  const toolChoiceRequirements = toolChoiceRequirementsForDraft(draft);
  const manualChoiceRequirements = manualChoiceRequirementsForDraft(draft);
  const languageChoiceCount = languageChoiceCountForDraft(draft);
  const expertiseCount = expertiseCountForDraft(draft);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(draft));
    const timer = window.setTimeout(() => setNotice("Draft saved on this device."), 350);
    return () => window.clearTimeout(timer);
  }, [draft, storageKey]);

  useEffect(() => {
    let active = true;
    void buildCharacterCreatorReview(draft, sheet).then((next) => { if (active) setReview(next); });
    return () => { active = false; };
  }, [draft, sheet]);

  function update(next: CharacterCreatorDraft, reconcile = true) {
    setDraft(reconcile ? reconcileCharacterCreatorDraft(next) : next);
    setConfirmation("");
    setNotice("Saving draft…");
  }

  function patch(value: Partial<CharacterCreatorDraft>, reconcile = true) {
    update({ ...draft, ...value }, reconcile);
  }

  function updateClass(rowId: string, values: Partial<CharacterCreatorDraft["classLevels"][number]>) {
    update({ ...draft, classLevels: draft.classLevels.map((row) => row.rowId === rowId ? { ...row, ...values } : row) });
  }

  function addClass() {
    if (draft.classLevels.length >= 13) return;
    update({ ...draft, classLevels: [...draft.classLevels, { rowId: `class-${crypto.randomUUID()}`, classId: "", levels: 0 }] });
  }

  function removeClass(rowId: string) {
    if (draft.classLevels.length === 1) return;
    update({ ...draft, classLevels: draft.classLevels.filter((row) => row.rowId !== rowId) });
  }

  function moveClass(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.classLevels.length) return;
    const classLevels = [...draft.classLevels];
    [classLevels[index], classLevels[target]] = [classLevels[target], classLevels[index]];
    update({ ...draft, classLevels });
  }

  function toggleSkill(classId: string, skill: SkillId, maximum: number) {
    const selected = draft.skillChoices[classId] ?? [];
    const next = selected.includes(skill) ? selected.filter((id) => id !== skill) : selected.length < maximum ? [...selected, skill] : selected;
    patch({ skillChoices: { ...draft.skillChoices, [classId]: next } });
  }

  function toggleLanguage(language: string) {
    patch({ languages: toggleLimited(draft.languages, language, languageChoiceCount) });
  }

  function toggleExpertise(skill: SkillId, maximum: number) {
    patch({ expertise: toggleLimited(draft.expertise, skill, maximum) as SkillId[] });
  }

  function toggleOption(key: string, optionId: string, maximum: number) {
    patch({ optionSelections: { ...draft.optionSelections, [key]: toggleLimited(draft.optionSelections[key] ?? [], optionId, maximum) } });
  }

  function spellChoices(classId: string): CreatorSpellChoices {
    return draft.spells[classId] ?? { cantrips: [], prepared: [], spellbook: [] };
  }

  function toggleSpell(classId: string, kind: keyof CreatorSpellChoices, spellId: string, maximum: number) {
    const current = spellChoices(classId);
    patch({ spells: { ...draft.spells, [classId]: { ...current, [kind]: toggleLimited(current[kind], spellId, maximum) } } });
  }

  function toggleSpellChoice(key: string, spellId: string, maximum: number) {
    patch({ spellChoiceSelections: { ...draft.spellChoiceSelections, [key]: toggleLimited(draft.spellChoiceSelections[key] ?? [], spellId, maximum) } });
  }

  function chooseAbilityMethod(method: CharacterCreatorDraft["abilityMethod"]) {
    patch({ abilityMethod: method });
  }

  function discardDraft() {
    localStorage.removeItem(storageKey);
    setDraft(createCharacterCreatorDraft(sheet));
    setStep("Basics");
    setNotice("Saved draft discarded. The live sheet was not changed.");
  }

  async function apply() {
    if (!review || confirmation !== review.fingerprint || review.status === "incomplete") return;
    setBusy(true);
    setNotice("Applying through the native sheet…");
    try {
      await onApply(draft, confirmation);
      localStorage.removeItem(storageKey);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The character could not be applied. Your draft is still saved.");
      setBusy(false);
    }
  }

  return (
    <div className="character-builder-backdrop">
      <section className="character-creator" role="dialog" aria-modal="true" aria-labelledby="character-creator-title">
        <header className="creator-header">
          <div>
            <span>Guided revised-2024 character creation</span>
            <h2 id="character-creator-title">Character Creator</h2>
            <p>Build levels 1–20 from the private 5.5e catalogue. Nothing suggested is selected for you.</p>
          </div>
          <button className="creator-close" aria-label="Close character creator" onClick={onClose}>×</button>
        </header>

        <div className="creator-shell">
          <nav className="creator-steps" aria-label="Character creator steps">
            {steps.map((label, index) => {
              const count = issues.filter((issue) => issue.step === label && issue.blocking).length;
              return <button key={label} className={step === label ? "active" : ""} aria-current={step === label ? "step" : undefined} onClick={() => setStep(label)}><b>{index + 1}</b><span>{label}</span>{count > 0 && <em aria-label={`${count} choices remaining`}>{count}</em>}</button>;
            })}
            <div className="creator-progress"><span>{issues.filter(({ blocking }) => blocking).length ? `${issues.filter(({ blocking }) => blocking).length} required choices remain` : "All required choices complete"}</span><progress max={steps.length} value={steps.filter((label) => !issues.some((issue) => issue.step === label && issue.blocking)).length} /></div>
          </nav>

          <main className="creator-body">
            {draft.changeNotices.length > 0 && <div className="creator-warning"><b>Earlier choices changed</b><p>The creator kept unaffected work and removed only choices that no longer fit:</p><ul>{draft.changeNotices.map((message) => <li key={message}>{message}</li>)}</ul><button onClick={() => patch({ changeNotices: [] }, false)}>Dismiss this history</button></div>}
            {step === "Basics" && <BasicsStep draft={draft} update={update} patch={patch} classes={classes} species={species} background={background} totalLevel={totalLevel} updateClass={updateClass} addClass={addClass} removeClass={removeClass} moveClass={moveClass} />}
            {step === "Abilities" && <AbilitiesStep draft={draft} patch={patch} background={background} chooseMethod={chooseAbilityMethod} />}
            {step === "Proficiencies" && <ProficienciesStep draft={draft} species={species} background={background} skillChoiceRequirements={skillChoiceRequirements} toolChoiceRequirements={toolChoiceRequirements} languageChoiceCount={languageChoiceCount} expertiseCount={expertiseCount} toggleSkill={toggleSkill} toggleLanguage={toggleLanguage} toggleExpertise={toggleExpertise} patch={patch} />}
            {step === "Features" && <FeaturesStep draft={draft} classes={classes} featSlots={featSlots} requirements={optionRequirements} manualRequirements={manualChoiceRequirements} toggleOption={toggleOption} patch={patch} />}
            {step === "Spells" && <SpellsStep draft={draft} classes={classes} search={spellSearch} setSearch={setSpellSearch} toggleSpell={toggleSpell} toggleSpellChoice={toggleSpellChoice} />}
            {step === "Equipment" && <EquipmentStep draft={draft} classes={classes} background={background} patch={patch} />}
            {step === "Review" && <ReviewStep draft={draft} review={review} confirmation={confirmation} setConfirmation={setConfirmation} patch={patch} rebase={() => update(rebaseCharacterCreatorDraft(draft, sheet), false)} />}
          </main>

          <aside className="creator-summary" aria-label="Live character summary">
            <span>Live summary</span>
            <strong>{draft.name.trim() || "Unnamed character"}</strong>
            <p>{totalLevel ? `Level ${totalLevel}` : "Choose a level"}<br />{classes.map(({ row, data }) => data ? `${data.name} ${row.levels}` : "Unselected class").join(" / ")}</p>
            <dl>
              <div><dt>Species</dt><dd>{species?.name ?? "—"}{draft.lineage ? ` · ${draft.lineage}` : ""}</dd></div>
              <div><dt>Background</dt><dd>{background?.name ?? "—"}</dd></div>
              <div><dt>Method</dt><dd>{draft.abilityMethod ? title(draft.abilityMethod) : "—"}</dd></div>
              <div><dt>Source</dt><dd>{characterCatalogue.source.edition}</dd></div>
            </dl>
            {review?.computation && <><div className="creator-score-strip">{abilityKeys.map((ability) => <span key={ability}><b>{ability.toUpperCase()}</b>{review.computation.finalScores[ability] || "—"}</span>)}</div><p className="creator-derived">{review.computation.hitPoints} HP · AC {review.computation.armorClass} · +{review.computation.proficiency} proficiency</p></>}
            <small>{notice}</small>
          </aside>
        </div>

        <footer className="creator-footer">
          <div><button onClick={discardDraft}>Discard draft</button><button onClick={onClose}>Save and close</button></div>
          <div><button disabled={steps.indexOf(step) === 0} onClick={() => setStep(steps[Math.max(0, steps.indexOf(step) - 1)])}>Back</button>{step !== "Review" ? <button className="builder-primary" onClick={() => setStep(steps[Math.min(steps.length - 1, steps.indexOf(step) + 1)])}>Continue</button> : <button className="builder-primary" disabled={busy || !review || review.status === "incomplete" || confirmation !== review.fingerprint} onClick={apply}>{busy ? "Applying…" : "Apply to sheet"}</button>}</div>
        </footer>
      </section>
    </div>
  );
}

function BasicsStep({ draft, update, patch, classes, species, background, totalLevel, updateClass, addClass, removeClass, moveClass }: {
  draft: CharacterCreatorDraft;
  update(next: CharacterCreatorDraft): void;
  patch(value: Partial<CharacterCreatorDraft>): void;
  classes: Array<{ row: CharacterCreatorDraft["classLevels"][number]; data: ReturnType<typeof catalogueClass> }>;
  species: ReturnType<typeof catalogueSpecies>;
  background: ReturnType<typeof catalogueBackground>;
  totalLevel: number;
  updateClass(rowId: string, values: Partial<CharacterCreatorDraft["classLevels"][number]>): void;
  addClass(): void;
  removeClass(rowId: string): void;
  moveClass(index: number, direction: -1 | 1): void;
}) {
  const speciesMagic = speciesMagicForDraft(draft);
  return <CreatorSection title="Choose the foundation" copy="Class order matters: the first row is the starting class and owns starting saves, proficiencies, and the maximum first Hit Die.">
    <label className="creator-wide">Character name<input autoFocus value={draft.name} onChange={(event) => patch({ name: event.target.value })} placeholder="Name your character" /></label>
    <div className="creator-class-list">
      {classes.map(({ row }, index) => <div className="creator-class-row" key={row.rowId}>
        <span>{index === 0 ? "Starting class" : `Multiclass ${index}`}</span>
        <select aria-label={`${index === 0 ? "Starting" : "Multiclass"} class`} value={row.classId} onChange={(event) => updateClass(row.rowId, { classId: event.target.value })}><option value="">Choose class</option>{characterCatalogue.classes.map((option) => <option key={option.id} value={option.id} disabled={draft.classLevels.some((candidate) => candidate.rowId !== row.rowId && candidate.classId === option.id)}>{option.name} · {option.source}</option>)}</select>
        <label>Levels<input type="number" min="1" max="20" value={row.levels || ""} onChange={(event) => updateClass(row.rowId, { levels: Number(event.target.value) })} /></label>
        <div><button disabled={index === 0} aria-label="Move class earlier" onClick={() => moveClass(index, -1)}>↑</button><button disabled={index === classes.length - 1} aria-label="Move class later" onClick={() => moveClass(index, 1)}>↓</button><button disabled={classes.length === 1} aria-label="Remove class" onClick={() => removeClass(row.rowId)}>×</button></div>
      </div>)}
      <button className="creator-add" disabled={classes.length >= 13 || totalLevel >= 20} onClick={addClass}>+ Add another class</button>
      <p className={totalLevel >= 1 && totalLevel <= 20 ? "creator-count complete" : "creator-count"}>{totalLevel || 0} of 20 total levels</p>
    </div>
    <div className="creator-field-grid">
      <label>Species<select value={draft.speciesId} onChange={(event) => update({ ...draft, speciesId: event.target.value })}><option value="">Choose species</option>{characterCatalogue.species.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.source}</option>)}</select></label>
      {species?.lineages.length ? <label>Lineage or ancestry<select value={draft.lineage} onChange={(event) => patch({ lineage: event.target.value })}><option value="">Choose lineage</option>{species.lineages.map((lineage) => <option key={lineage}>{lineage}</option>)}</select></label> : null}
      {speciesMagic?.abilityChoices.length === 1 ? <div className="creator-fixed"><span>Innate spellcasting</span><b>{abilityLabels[speciesMagic.abilityChoices[0]]}</b><small>Fixed by {species?.name ?? "species"}</small></div> : speciesMagic?.abilityChoices.length ? <label>Innate spellcasting ability<select value={draft.speciesCastingAbility} onChange={(event) => patch({ speciesCastingAbility: event.target.value as AbilityKey })}><option value="">Choose ability</option>{speciesMagic.abilityChoices.map((ability) => <option key={ability} value={ability}>{abilityLabels[ability]}</option>)}</select></label> : null}
      {species && species.sizes.length > 1 ? <label>Size<select value={draft.size} onChange={(event) => patch({ size: event.target.value })}><option value="">Choose size</option>{species.sizes.map((size) => <option key={size}>{size}</option>)}</select></label> : species ? <div className="creator-fixed"><span>Size</span><b>{species.sizes[0]}</b><small>Fixed by {species.name}</small></div> : null}
      <label>Background<select value={draft.backgroundId} onChange={(event) => update({ ...draft, backgroundId: event.target.value })}><option value="">Choose background</option>{characterCatalogue.backgrounds.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.source}</option>)}</select></label>
    </div>
    {(species || background) && <div className="creator-attribution">{species && <article><b>{species.name}</b><span>{species.speed}-foot speed · {species.traits.join(" · ")}</span></article>}{background && <article><b>{background.name}</b><span>{background.skills.map(skillName).join(" and ")} · {title(background.originFeatId)} feat</span></article>}</div>}
  </CreatorSection>;
}

function AbilitiesStep({ draft, patch, background, chooseMethod }: { draft: CharacterCreatorDraft; patch(value: Partial<CharacterCreatorDraft>): void; background: ReturnType<typeof catalogueBackground>; chooseMethod(method: CharacterCreatorDraft["abilityMethod"]): void }) {
  const cost = pointBuyCost(Object.fromEntries(abilityKeys.map((ability) => [ability, Number(draft.baseScores[ability])])) as Record<AbilityKey, number>);
  return <CreatorSection title="Set ability scores" copy="Pick a method first. Recommendations never populate fields until you explicitly choose to use them.">
    <div className="creator-choice-tabs" role="group" aria-label="Ability score method">{(["standard", "point-buy", "rolled"] as const).map((method) => <button key={method} className={draft.abilityMethod === method ? "selected" : ""} onClick={() => chooseMethod(method)}>{method === "standard" ? "Standard Array" : method === "point-buy" ? "27-point buy" : "Enter / rolled"}</button>)}</div>
    {draft.abilityMethod === "point-buy" && <button className="creator-add" onClick={() => patch({ baseScores: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } })}>Start all scores at 8</button>}
    <div className="creator-ability-grid">
      {abilityKeys.map((ability) => <label key={ability}><span>{abilityLabels[ability]}</span>{draft.abilityMethod === "standard" ? <select value={draft.baseScores[ability] ?? ""} onChange={(event) => patch({ baseScores: { ...draft.baseScores, [ability]: event.target.value ? Number(event.target.value) : null } })}><option value="">Assign score</option>{characterCatalogue.rules.standardArray.map((score) => <option key={score}>{score}</option>)}</select> : <input type="number" min={draft.abilityMethod === "point-buy" ? 8 : 3} max={draft.abilityMethod === "point-buy" ? 15 : 18} value={draft.baseScores[ability] ?? ""} disabled={!draft.abilityMethod} onChange={(event) => patch({ baseScores: { ...draft.baseScores, [ability]: event.target.value ? Number(event.target.value) : null } })} />}<small>{draft.baseScores[ability] == null ? "Not assigned" : `Base ${draft.baseScores[ability]}`}</small></label>)}
    </div>
    {draft.abilityMethod === "point-buy" && <p className={`creator-count ${cost === 27 ? "complete" : ""}`}>{Number.isFinite(cost) ? cost : "—"} of 27 points spent</p>}
    <fieldset className="creator-card"><legend>Background improvements</legend>{background ? <><p>{background.name} can improve {background.abilities.map((ability) => ability.toUpperCase()).join(", ")}.</p><div className="creator-choice-tabs"><button className={draft.boostMode === "2+1" ? "selected" : ""} onClick={() => patch({ boostMode: "2+1" })}>+2 and +1</button><button className={draft.boostMode === "1+1+1" ? "selected" : ""} onClick={() => patch({ boostMode: "1+1+1" })}>+1 to all three</button></div>{draft.boostMode === "2+1" && <div className="creator-field-grid"><label>Increase by 2<select value={draft.boostTwo} onChange={(event) => patch({ boostTwo: event.target.value as AbilityKey })}><option value="">Choose ability</option>{background.abilities.map((ability) => <option key={ability} value={ability}>{abilityLabels[ability]}</option>)}</select></label><label>Increase by 1<select value={draft.boostOne} onChange={(event) => patch({ boostOne: event.target.value as AbilityKey })}><option value="">Choose a different ability</option>{background.abilities.map((ability) => <option key={ability} value={ability}>{abilityLabels[ability]}</option>)}</select></label></div>}</> : <p>Choose a background first.</p>}</fieldset>
  </CreatorSection>;
}

function ProficienciesStep({ draft, species, background, skillChoiceRequirements, toolChoiceRequirements, languageChoiceCount, expertiseCount, toggleSkill, toggleLanguage, toggleExpertise, patch }: {
  draft: CharacterCreatorDraft;
  species: ReturnType<typeof catalogueSpecies>; background: ReturnType<typeof catalogueBackground>;
  skillChoiceRequirements: ReturnType<typeof skillChoiceRequirementsForDraft>;
  toolChoiceRequirements: ReturnType<typeof toolChoiceRequirementsForDraft>;
  languageChoiceCount: number; expertiseCount: number;
  toggleSkill(key: string, skill: SkillId, maximum: number): void; toggleLanguage(language: string): void; toggleExpertise(skill: SkillId, maximum: number): void; patch(value: Partial<CharacterCreatorDraft>): void;
}) {
  const fixed = new Set<SkillId>(background?.skills ?? []);
  const selected = new Set<SkillId>([...fixed, ...Object.values(draft.skillChoices).flat(), ...(draft.speciesSkill ? [draft.speciesSkill] : [])]);
  return <CreatorSection title="Choose proficiencies" copy="Fixed grants are attributed below. Choices stay separate, and duplicate grants are never spent silently.">
    {background && <div className="creator-fixed"><span>{background.name} skills</span><b>{background.skills.map(skillName).join(", ")}</b><small>Fixed background grant</small></div>}
    {skillChoiceRequirements.map((requirement) => {
      const options = requirement.from === "any" ? skillDefinitions.map(({ id }) => id) : requirement.from;
      const chosen = draft.skillChoices[requirement.key] ?? [];
      const unavailable = new Set<SkillId>([
        ...fixed,
        ...Object.entries(draft.skillChoices).filter(([key]) => key !== requirement.key).flatMap(([, values]) => values),
        ...(draft.speciesSkill ? [draft.speciesSkill] : []),
      ]);
      return <fieldset className="creator-card" key={requirement.key}><legend>{requirement.sourceLabel}: {requirement.label}</legend><p>{chosen.length} of {requirement.count} selected</p><div className="creator-check-grid">{options.map((skill) => <CheckOption key={skill} checked={chosen.includes(skill)} disabled={!chosen.includes(skill) && (chosen.length >= requirement.count || unavailable.has(skill))} onChange={() => toggleSkill(requirement.key, skill, requirement.count)} label={skillName(skill)} detail={unavailable.has(skill) ? "Already granted" : ""} />)}</div></fieldset>;
    })}
    {species?.skillChoice.count ? <label className="creator-wide">{species.name} skill<select value={draft.speciesSkill} onChange={(event) => patch({ speciesSkill: event.target.value as SkillId })}><option value="">Choose skill</option>{(species.skillChoice.from === "any" ? skillDefinitions.map(({ id }) => id) : species.skillChoice.from).map((skill) => <option key={skill} value={skill} disabled={selected.has(skill) && draft.speciesSkill !== skill}>{skillName(skill)}</option>)}</select></label> : null}
    {expertiseCount > 0 && <fieldset className="creator-card"><legend>Expertise</legend><p>{draft.expertise.length} of {expertiseCount} proficient skills selected. Wizard Scholar must use Arcana, History, Investigation, Medicine, Nature, or Religion.</p><div className="creator-check-grid">{[...selected].map((skill) => <CheckOption key={skill} label={skillName(skill)} checked={draft.expertise.includes(skill)} disabled={!draft.expertise.includes(skill) && draft.expertise.length >= expertiseCount} onChange={() => toggleExpertise(skill, expertiseCount)} />)}</div></fieldset>}
    {toolChoiceRequirements.map((requirement) => <fieldset className="creator-card" key={requirement.key}><legend>{requirement.sourceLabel}: {requirement.label}</legend><p>Name {requirement.count} player-chosen {requirement.label.toLowerCase()}{requirement.count === 1 ? "" : " options"}.</p>{Array.from({ length: requirement.count }, (_, index) => <label key={index}>{requirement.label} {index + 1}<input value={draft.toolChoices[requirement.key]?.[index] ?? ""} onChange={(event) => { const values = [...(draft.toolChoices[requirement.key] ?? Array(requirement.count).fill(""))]; values[index] = event.target.value; patch({ toolChoices: { ...draft.toolChoices, [requirement.key]: values } }); }} placeholder="Name the player's choice" /></label>)}</fieldset>)}
    <fieldset className="creator-card"><legend>Additional languages</legend><p>{draft.languages.length} of {languageChoiceCount} selected. Common is fixed; Druidic and Thieves&apos; Cant are added automatically when granted.</p><div className="creator-check-grid">{characterCatalogue.rules.languages.map((language) => <CheckOption key={language} label={language} checked={draft.languages.includes(language)} disabled={!draft.languages.includes(language) && draft.languages.length >= languageChoiceCount} onChange={() => toggleLanguage(language)} />)}</div></fieldset>
  </CreatorSection>;
}

function FeaturesStep({ draft, classes, featSlots, requirements, manualRequirements, toggleOption, patch }: {
  draft: CharacterCreatorDraft; classes: Array<{ row: CharacterCreatorDraft["classLevels"][number]; data: ReturnType<typeof catalogueClass> }>;
  featSlots: ReturnType<typeof featSlotsForDraft>; requirements: ReturnType<typeof optionRequirementsForDraft>;
  manualRequirements: ReturnType<typeof manualChoiceRequirementsForDraft>;
  toggleOption(key: string, optionId: string, maximum: number): void; patch(value: Partial<CharacterCreatorDraft>): void;
}) {
  return <CreatorSection title="Choose subclasses, feats, and class options" copy="Only options unlocked by the selected class levels and numeric prerequisites are shown. Free-form or source-text judgments stay explicit in Manual rulings.">
    {classes.map(({ row, data }) => {
      if (!data) return null;
      const unlocked = data.subclasses.filter(({ level }) => level <= row.levels);
      return <article className="creator-feature-list" key={row.rowId}><header><b>{data.name} {row.levels}</b><span>{data.source}</span></header><p>{data.features.filter(({ level }) => level <= row.levels).map(({ name, level }) => `${level}: ${name}`).join(" · ")}</p>{unlocked.length > 0 && <label>Subclass<select value={draft.subclasses[row.classId] ?? ""} onChange={(event) => patch({ subclasses: { ...draft.subclasses, [row.classId]: event.target.value } })}><option value="">Choose subclass</option>{unlocked.map((subclass) => <option key={subclass.id} value={subclass.id}>{subclass.name} · {subclass.source}</option>)}</select></label>}</article>;
    })}
    {featSlots.map((slot) => {
      const choice = draft.feats[slot.id] ?? { featId: "", abilityIncreases: {} };
      const options = availableFeatsForSlot(draft, slot);
      const feat = catalogueFeat(choice.featId);
      return <fieldset className="creator-card" key={slot.id}><legend>{slot.label}</legend><label>Feat<select value={choice.featId} onChange={(event) => patch({ feats: { ...draft.feats, [slot.id]: { featId: event.target.value, abilityIncreases: {} } } })}><option value="">Choose feat</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.source}</option>)}</select></label>{feat?.summary && <p>{feat.summary}</p>}{feat && feat.ability.length > 0 && <div className="creator-increase-row">{abilityKeys.map((ability) => <label key={ability}>{ability.toUpperCase()}<input type="number" min="0" max="2" value={choice.abilityIncreases[ability] ?? 0} onChange={(event) => patch({ feats: { ...draft.feats, [slot.id]: { ...choice, abilityIncreases: { ...choice.abilityIncreases, [ability]: Number(event.target.value) } } } })} /></label>)}</div>}</fieldset>;
    })}
    {requirements.map((requirement) => <fieldset className="creator-card" key={requirement.key}><legend>{catalogueClass(requirement.classId)?.name}: {requirement.label}</legend><p>{(draft.optionSelections[requirement.key] ?? []).length} of {requirement.count} selected.</p><div className="creator-option-list">{requirement.options.map((option) => { const selected = draft.optionSelections[requirement.key] ?? []; return <CheckOption key={option.id} checked={selected.includes(option.id)} disabled={!selected.includes(option.id) && selected.length >= requirement.count} onChange={() => toggleOption(requirement.key, option.id, requirement.count)} label={option.name} detail={option.source} />; })}</div></fieldset>)}
    {manualRequirements.length > 0 && <section className="creator-manual-choices"><h4>Player choices requiring exact text</h4><p>These source-owned decisions are not silently inferred. Record each answer; the final review will label the result for manual table review.</p>{manualRequirements.map((requirement) => <label className="creator-wide" key={requirement.key}>{requirement.sourceLabel}: {requirement.label}<small>{requirement.prompt}</small><textarea value={draft.manualChoices[requirement.key] ?? ""} onChange={(event) => patch({ manualChoices: { ...draft.manualChoices, [requirement.key]: event.target.value } })} placeholder="Record the player's exact confirmed answer" /></label>)}</section>}
    <label className="creator-wide">Manual rulings or unsupported intent<textarea value={draft.manualRulings} onChange={(event) => patch({ manualRulings: event.target.value })} placeholder="Record the player's exact choice when the catalogue cannot validate it. The review will label this for table review rather than substituting another option." /></label>
  </CreatorSection>;
}

function SpellsStep({ draft, classes, search, setSearch, toggleSpell, toggleSpellChoice }: {
  draft: CharacterCreatorDraft; classes: Array<{ row: CharacterCreatorDraft["classLevels"][number]; data: ReturnType<typeof catalogueClass> }>;
  search: string; setSearch(value: string): void; toggleSpell(classId: string, kind: keyof CreatorSpellChoices, spellId: string, maximum: number): void;
  toggleSpellChoice(key: string, spellId: string, maximum: number): void;
}) {
  const casters = classes.flatMap(({ row, data }) => {
    const casting = data ? castingDetailsForDraft(draft, row.classId) : null;
    return data && casting ? [{ row, data, casting }] : [];
  });
  const bonusRequirements = spellChoiceRequirementsForDraft(draft);
  return <CreatorSection title="Choose spells" copy="Each class uses its own spell-level access. Shared multiclass slots never unlock higher-level selections, and always-prepared subclass spells do not consume these counts.">
    {(casters.length > 0 || bonusRequirements.length > 0) && <label className="creator-wide">Filter spells<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, source, level…" /></label>}
    {!casters.length && !bonusRequirements.length && <div className="creator-empty"><b>No spellcasting choices at these levels.</b><span>Martial features and equipment remain on their own steps.</span></div>}
    {casters.map(({ row, data, casting }) => {
      const choices = draft.spells[row.classId] ?? { cantrips: [], prepared: [], spellbook: [] };
      const { cantrips, prepared, spellbook } = casting;
      const availableCantrips = availableSpellsForDraft(draft, row.classId, true);
      const availablePrepared = availableSpellsForDraft(draft, row.classId, false);
      const bonusSpellbookIds = bonusRequirements.filter((requirement) => requirement.classId === row.classId && requirement.destination === "spellbook").flatMap(({ key }) => draft.spellChoiceSelections[key] ?? []);
      const spellbookPool = new Set([...choices.spellbook, ...bonusSpellbookIds]);
      return <article className="creator-spell-class" key={row.rowId}><header><div><b>{casting.profileName} · {data.name} {row.levels}</b><span>{casting.ability.toUpperCase()} · {casting.progression === "pact" ? "Pact Magic" : "Spellcasting"}</span></div><p>{cantrips} cantrips · {prepared} chosen prepared/known{spellbook ? ` · ${spellbook} core spellbook spells` : ""}</p></header>{cantrips > 0 && <SpellChecklist label="Cantrips" kind="cantrips" classId={row.classId} selected={choices.cantrips} maximum={cantrips} spells={availableCantrips} search={search} toggle={toggleSpell} />}{spellbook > 0 && <SpellChecklist label="Core spellbook" kind="spellbook" classId={row.classId} selected={choices.spellbook} maximum={spellbook} spells={availablePrepared} search={search} toggle={toggleSpell} />}{prepared > 0 && <SpellChecklist label={spellbook ? "Prepared from spellbook" : "Prepared / known spells"} kind="prepared" classId={row.classId} selected={choices.prepared} maximum={prepared} spells={spellbook ? availablePrepared.filter(({ id }) => spellbookPool.has(id)) : availablePrepared} search={search} toggle={toggleSpell} />}</article>;
    })}
    {bonusRequirements.map((requirement) => <fieldset className="creator-spell-list" key={requirement.key}><legend>{requirement.label} <small>{(draft.spellChoiceSelections[requirement.key] ?? []).length} / {requirement.count}</small></legend><p className="creator-muted">{requirement.sourceLabel} · add to {requirement.destination === "spellbook" ? "spellbook" : "known / prepared spells"}</p><div>{requirement.spells.filter((spell) => !search.trim() || `${spell.name} ${spell.source} level ${spell.level}`.toLowerCase().includes(search.trim().toLowerCase())).map((spell) => { const selected = draft.spellChoiceSelections[requirement.key] ?? []; return <CheckOption key={spell.id} checked={selected.includes(spell.id)} disabled={!selected.includes(spell.id) && selected.length >= requirement.count} onChange={() => toggleSpellChoice(requirement.key, spell.id, requirement.count)} label={spell.name} detail={`${spell.level ? `Level ${spell.level}` : "Cantrip"} · ${spell.source}`} />; })}</div></fieldset>)}
  </CreatorSection>;
}

function SpellChecklist({ label, kind, classId, selected, maximum, spells, search, toggle }: { label: string; kind: keyof CreatorSpellChoices; classId: string; selected: string[]; maximum: number; spells: ReturnType<typeof availableSpells>; search: string; toggle(classId: string, kind: keyof CreatorSpellChoices, spellId: string, maximum: number): void }) {
  const query = search.trim().toLowerCase();
  const shown = spells.filter((spell) => !query || `${spell.name} ${spell.source} level ${spell.level}`.toLowerCase().includes(query));
  return <fieldset className="creator-spell-list"><legend>{label} <small>{selected.length} / {maximum}</small></legend><div>{shown.map((spell) => <CheckOption key={spell.id} checked={selected.includes(spell.id)} disabled={!selected.includes(spell.id) && selected.length >= maximum} onChange={() => toggle(classId, kind, spell.id, maximum)} label={spell.name} detail={`${spell.level ? `Level ${spell.level}` : "Cantrip"} · ${spell.source}${spell.compatibility !== "revised" ? " · legacy source / revised list" : ""}`} />)}</div>{shown.length === 0 && <p className="creator-muted">No matching spells.</p>}</fieldset>;
}

function EquipmentStep({ draft, classes, background, patch }: { draft: CharacterCreatorDraft; classes: Array<{ row: CharacterCreatorDraft["classLevels"][number]; data: ReturnType<typeof catalogueClass> }>; background: ReturnType<typeof catalogueBackground>; patch(value: Partial<CharacterCreatorDraft>): void }) {
  const firstClass = classes[0]?.data;
  const selectedChoices = [firstClass?.equipment.find(({ id }) => id === draft.equipment.classPackageId), background?.equipment.find(({ id }) => id === draft.equipment.backgroundPackageId)].filter(Boolean) as CatalogueEquipmentChoice[];
  const finesseItems = selectedChoices.flatMap(({ items }) => items).flatMap((entry) => { const item = characterCatalogue.items.find(({ id }) => id === entry.id); return item?.properties.includes("F") ? [item] : []; });
  return <CreatorSection title="Choose starting equipment and derived defenses" copy="Only the starting class grants a class package. Multiclass training does not duplicate starting gear. HP and AC formulas are explicit choices.">
    {firstClass && <PackageChoices label={`${firstClass.name} starting package`} choices={firstClass.equipment} selected={draft.equipment.classPackageId} choose={(id) => patch({ equipment: { ...draft.equipment, classPackageId: id } })} />}
    {background && <PackageChoices label={`${background.name} starting package`} choices={background.equipment} selected={draft.equipment.backgroundPackageId} choose={(id) => patch({ equipment: { ...draft.equipment, backgroundPackageId: id } })} />}
    {selectedChoices.flatMap((choice) => choice.items.filter(({ prompt }) => prompt).map((item) => ({ choice, item }))).map(({ choice, item }) => { const key = equipmentItemChoiceKey(choice.id, item.id); return <label className="creator-wide" key={key}>{item.prompt}<input value={draft.equipment.customNames[key] ?? ""} onChange={(event) => patch({ equipment: { ...draft.equipment, customNames: { ...draft.equipment.customNames, [key]: event.target.value } } })} placeholder="Name the player's choice" /></label>; })}
    {finesseItems.map((item) => <fieldset className="creator-card" key={item.id}><legend>{item.name} attack ability</legend><div className="creator-choice-tabs"><button className={draft.weaponAbilities[item.id] === "str" ? "selected" : ""} onClick={() => patch({ weaponAbilities: { ...draft.weaponAbilities, [item.id]: "str" } })}>Strength</button><button className={draft.weaponAbilities[item.id] === "dex" ? "selected" : ""} onClick={() => patch({ weaponAbilities: { ...draft.weaponAbilities, [item.id]: "dex" } })}>Dexterity</button></div></fieldset>)}
    <fieldset className="creator-card"><legend>Hit Points</legend><div className="creator-choice-tabs"><button className={draft.hpMode === "fixed" ? "selected" : ""} onClick={() => patch({ hpMode: "fixed" })}>Use fixed gains</button><button className={draft.hpMode === "manual" ? "selected" : ""} onClick={() => patch({ hpMode: "manual" })}>Enter approved total</button></div>{draft.hpMode === "manual" && <label>Hit Point maximum<input type="number" min="1" value={draft.manualHitPoints ?? ""} onChange={(event) => patch({ manualHitPoints: event.target.value ? Number(event.target.value) : null })} /></label>}<label className="creator-inline-check"><input type="checkbox" checked={draft.resetCurrentHitPoints} onChange={(event) => patch({ resetCurrentHitPoints: event.target.checked })} /> Reset current HP to the new maximum on apply</label><small>Otherwise reapplication preserves current damage within the new maximum.</small></fieldset>
    <fieldset className="creator-card"><legend>Armor Class — choose one formula</legend><div className="creator-choice-tabs wrap">{(["equipped", "unarmored", ...(classes.some(({ data }) => data?.name === "Barbarian") ? ["barbarian"] : []), ...(classes.some(({ data }) => data?.name === "Monk") ? ["monk"] : []), "manual"] as CharacterCreatorDraft["armorClassMode"][]).map((mode) => <button key={mode} className={draft.armorClassMode === mode ? "selected" : ""} onClick={() => patch({ armorClassMode: mode })}>{mode === "equipped" ? "Equipped armor" : mode === "unarmored" ? "10 + DEX" : mode === "barbarian" ? "Barbarian: DEX + CON" : mode === "monk" ? "Monk: DEX + WIS" : "Enter approved AC"}</button>)}</div>{draft.armorClassMode === "manual" && <label>Armor Class<input type="number" min="1" value={draft.manualArmorClass ?? ""} onChange={(event) => patch({ manualArmorClass: event.target.value ? Number(event.target.value) : null })} /></label>}<small>Alternatives never stack.</small></fieldset>
  </CreatorSection>;
}

function ReviewStep({ draft, review, confirmation, setConfirmation, patch, rebase }: { draft: CharacterCreatorDraft; review: CharacterCreatorReview | null; confirmation: string; setConfirmation(value: string): void; patch(value: Partial<CharacterCreatorDraft>, reconcile?: boolean): void; rebase(): void }) {
  if (!review) return <div className="creator-empty"><b>Preparing character review…</b></div>;
  const stale = review.issues.some(({ code }) => code === "stale-target");
  return <CreatorSection title="Review the whole character" copy="Applying updates the native sheet. If the draft or live sheet changes, review the character again before applying.">
    <div className={`creator-review-status ${review.status}`}><b>{review.status === "ready" ? "Corpus-validated and ready" : review.status === "manual-review" ? "Ready with acknowledged manual review" : "Incomplete"}</b><span>{review.status === "incomplete" ? "Resolve the choices below" : "Ready to confirm"}</span></div>
    {stale && <div className="creator-warning"><b>The live sheet changed.</b><p>Refresh the review to keep this draft and compare it with the latest sheet.</p><button onClick={rebase}>Refresh from current sheet</button></div>}
    {review.issues.length > 0 && <section className="creator-review-issues"><h4>Choices to revisit</h4><ul>{review.issues.map((issue) => <li key={`${issue.step}-${issue.code}`}><b>{issue.step}</b> {issue.message}</li>)}</ul></section>}
    <section className="creator-review-summary"><h4>Whole-character summary</h4>{review.summary.map((line) => <p key={line}>{line}</p>)}</section>
    <section className="creator-review-changes"><h4>What applying will change</h4><ul>{review.changedFields.map((field) => <li key={field}>{field}</li>)}</ul><p>Portrait, sheet layout, theme, story, notes, ink, manual additions, token ownership, and unrelated play state stay in place.</p></section>
    {review.computation.manualReviewReasons.length > 0 && <label className="creator-confirm"><input type="checkbox" checked={draft.manualReviewAcknowledged} onChange={(event) => patch({ manualReviewAcknowledged: event.target.checked }, false)} /><span><b>I reviewed the manual rulings.</b> I understand these choices are preserved but not presented as fully corpus-validated.</span></label>}
    {review.status !== "incomplete" && <label className="creator-confirm"><input type="checkbox" checked={confirmation === review.fingerprint} onChange={(event) => setConfirmation(event.target.checked ? review.fingerprint : "")} /><span><b>I confirm this whole character.</b> I reviewed the choices and changes above and want to apply them to the sheet.</span></label>}
  </CreatorSection>;
}

function PackageChoices({ label, choices, selected, choose }: { label: string; choices: CatalogueEquipmentChoice[]; selected: string; choose(id: string): void }) {
  return <fieldset className="creator-card"><legend>{label}</legend><div className="creator-package-grid">{choices.map((choice) => <label key={choice.id} className={selected === choice.id ? "selected" : ""}><input type="radio" checked={selected === choice.id} onChange={() => choose(choice.id)} /><span><b>{choice.label}</b><small>{choice.items.map(({ name, quantity }) => `${quantity > 1 ? `${quantity} × ` : ""}${name}`).join(", ") || "No items"}{choice.gp ? ` · ${choice.gp} GP` : ""}</small></span></label>)}</div></fieldset>;
}

function CreatorSection({ title: heading, copy, children }: { title: string; copy: string; children: React.ReactNode }) {
  return <section className="creator-section"><div className="creator-section-copy"><span>Player-owned choices</span><h3>{heading}</h3><p>{copy}</p></div>{children}</section>;
}

function CheckOption({ checked, disabled = false, onChange, label, detail = "" }: { checked: boolean; disabled?: boolean; onChange(): void; label: string; detail?: string }) {
  return <label className={`creator-check ${checked ? "selected" : ""} ${disabled ? "disabled" : ""}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} /><span><b>{label}</b>{detail && <small>{detail}</small>}</span></label>;
}

function restoredDraft(storageKey: string, sheet: CharacterSheet): CharacterCreatorDraft {
  const base = createCharacterCreatorDraft(sheet);
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<CharacterCreatorDraft> | null;
    if (!raw || raw.schemaVersion !== 1 || raw.targetSheetId !== sheet.id) return base;
    return restoreCharacterCreatorDraft(raw, sheet);
  } catch {
    localStorage.removeItem(storageKey);
    return base;
  }
}

function toggleLimited(values: string[], value: string, maximum: number) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : values.length < maximum ? [...values, value] : values;
}

function skillName(id: SkillId) {
  return skillDefinitions.find((skill) => skill.id === id)?.label ?? id;
}

function title(value: string) {
  return value.replace(/[-;]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
