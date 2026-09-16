"use client";

import { useState } from "react";
import {
  builderBackgrounds,
  builderClasses,
  builderSpecies,
  classSkillChoices,
  createCharacterBuild,
  featureChoicesForBuild,
  reconcileFeatureChoices,
  standardArray,
  standardLanguages,
  type BuilderFeatureChoice,
  type CharacterBuild,
  validateCharacterBuild,
} from "@/lib/character-builder";
import { abilityKeys, type AbilityKey, type CharacterSheet, skillDefinitions, type SkillId } from "@/lib/character-sheet";

const steps = ["Basics", "Abilities", "Skills", "Features", "Review"] as const;
const abilityLabels: Record<AbilityKey, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution",
  int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};

export function CharacterBuilder({
  sheet,
  onApply,
  onClose,
}: {
  sheet: CharacterSheet;
  onApply(build: CharacterBuild): void;
  onClose(): void;
}) {
  const [step, setStep] = useState(0);
  const [build, setBuild] = useState(() => createCharacterBuild(sheet));
  const classData = builderClasses.find(({ name }) => name === build.className)!;
  const background = builderBackgrounds.find(({ name }) => name === build.background)!;
  const species = builderSpecies.find(({ name }) => name === build.species)!;
  const classSkills = classSkillChoices(classData, background);
  const featureChoices = featureChoicesForBuild(build);
  const featureSelections = featureChoices.map((choice) => ({
    title: choice.title,
    labels: (build.featureChoices[choice.id] ?? []).map((value) => choice.options.find((option) => option.value === value)?.label ?? value),
  }));
  const errors = validateCharacterBuild(build);
  const finalScores = { ...build.baseScores };
  if (build.boostMode === "1+1+1") background.abilities.forEach((ability) => finalScores[ability] += 1);
  else {
    finalScores[build.boostTwo] += 2;
    finalScores[build.boostOne] += 1;
  }

  function chooseClass(name: string) {
    const nextClass = builderClasses.find((option) => option.name === name)!;
    setBuild((current) => reconcileFeatureChoices(rebalance({ ...current, className: name, baseScores: { ...nextClass.recommended } }, nextClass, background)));
  }

  function chooseBackground(name: string) {
    const nextBackground = builderBackgrounds.find((option) => option.name === name)!;
    setBuild((current) => reconcileFeatureChoices(rebalance({ ...current, background: name }, classData, nextBackground)));
  }

  function chooseSpecies(name: string) {
    const nextSpecies = builderSpecies.find((option) => option.name === name)!;
    setBuild((current) => reconcileFeatureChoices({
      ...current,
      species: name,
      heritage: nextSpecies.heritages?.[0] ?? "",
      size: nextSpecies.sizes[nextSpecies.sizes.length - 1],
    }));
  }

  function toggleClassSkill(skill: SkillId) {
    setBuild((current) => {
      const selected = current.classSkills.includes(skill);
      if (!selected && current.classSkills.length >= classData.skillCount) return current;
      const next = { ...current, classSkills: selected ? current.classSkills.filter((id) => id !== skill) : [...current.classSkills, skill] };
      return selected ? next : reconcileFeatureChoices(next);
    });
  }

  function setSingleFeatureChoice(choice: BuilderFeatureChoice, value: string) {
    setBuild((current) => reconcileFeatureChoices({
      ...current,
      featureChoices: { ...current.featureChoices, [choice.id]: [value] },
    }));
  }

  function toggleFeatureChoice(choice: BuilderFeatureChoice, value: string) {
    setBuild((current) => {
      const selected = current.featureChoices[choice.id] ?? [];
      const next = selected.includes(value)
        ? selected.filter((option) => option !== value)
        : selected.length < choice.max ? [...selected, value] : selected;
      return { ...current, featureChoices: { ...current.featureChoices, [choice.id]: next } };
    });
  }

  return (
    <div className="character-builder-backdrop">
      <section className="character-builder" role="dialog" aria-modal="true" aria-labelledby="character-builder-title">
        <header>
          <div>
            <span>Guided 2024 character creation</span>
            <h2 id="character-builder-title">Character Builder</h2>
          </div>
          <button aria-label="Close character builder" onClick={onClose}>×</button>
        </header>

        <nav className="character-builder-steps" aria-label="Builder steps">
          {steps.map((label, index) => (
            <button key={label} className={step === index ? "active" : ""} aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}>
              <b>{index + 1}</b><span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="character-builder-body">
          {step === 0 && (
            <div className="builder-section">
              <div className="builder-copy"><h3>Who are you playing?</h3><p>Choose the level-one foundation. The finished character remains fully editable.</p></div>
              <div className="builder-field-grid">
                <label className="builder-wide-field">Character name<input autoFocus value={build.name} onChange={(event) => setBuild({ ...build, name: event.target.value })} /></label>
                <label>Class<select value={build.className} onChange={(event) => chooseClass(event.target.value)}>{builderClasses.map((option) => <option key={option.name}>{option.name}</option>)}</select></label>
                <label>Species<select value={build.species} onChange={(event) => chooseSpecies(event.target.value)}>{builderSpecies.map((option) => <option key={option.name}>{option.name}</option>)}</select></label>
                {species.heritages && <label>{species.heritageLabel ?? "Lineage or legacy"}<select value={build.heritage} onChange={(event) => setBuild({ ...build, heritage: event.target.value })}>{species.heritages.map((heritage) => <option key={heritage}>{heritage}</option>)}</select></label>}
                <label>Size<select value={build.size} onChange={(event) => setBuild({ ...build, size: event.target.value })}>{species.sizes.map((size) => <option key={size}>{size}</option>)}</select></label>
                <label>Background<select value={build.background} onChange={(event) => chooseBackground(event.target.value)}>{builderBackgrounds.map((option) => <option key={option.name}>{option.name}</option>)}</select></label>
                <label>Additional language<select value={build.languages[0]} onChange={(event) => setBuild({ ...build, languages: [event.target.value, build.languages[1]] })}>{standardLanguages.map((language) => <option key={language}>{language}</option>)}</select></label>
                <label>Additional language<select value={build.languages[1]} onChange={(event) => setBuild({ ...build, languages: [build.languages[0], event.target.value] })}>{standardLanguages.map((language) => <option key={language}>{language}</option>)}</select></label>
              </div>
              <div className="builder-summary-strip"><span><b>{classData.name}</b>d{classData.hitDie} Hit Die</span><span><b>{species.name}</b>{species.speed}-foot Speed</span><span><b>{background.name}</b>{background.feat}</span></div>
            </div>
          )}

          {step === 1 && (
            <div className="builder-section">
              <div className="builder-copy"><h3>Assign the Standard Array</h3><p>Use each score once, then apply the three abilities granted by your {background.name} background.</p></div>
              <div className="builder-ability-grid">
                {abilityKeys.map((ability) => (
                  <label key={ability}><span>{abilityLabels[ability]}</span><select value={build.baseScores[ability]} onChange={(event) => setBuild({ ...build, baseScores: { ...build.baseScores, [ability]: Number(event.target.value) } })}>{standardArray.map((score) => <option key={score}>{score}</option>)}</select><strong>{signed(Math.floor((finalScores[ability] - 10) / 2))}</strong><small>Final {finalScores[ability]}</small></label>
                ))}
              </div>
              <fieldset className="builder-boosts">
                <legend>Background improvements</legend>
                <label><input type="radio" checked={build.boostMode === "2+1"} onChange={() => setBuild({ ...build, boostMode: "2+1" })} /> +2 and +1</label>
                <label><input type="radio" checked={build.boostMode === "1+1+1"} onChange={() => setBuild({ ...build, boostMode: "1+1+1" })} /> +1 to all three</label>
                {build.boostMode === "2+1" && <><label>+2<select value={build.boostTwo} onChange={(event) => setBuild({ ...build, boostTwo: event.target.value as AbilityKey })}>{background.abilities.map((ability) => <option key={ability} value={ability}>{abilityLabels[ability]}</option>)}</select></label><label>+1<select value={build.boostOne} onChange={(event) => setBuild({ ...build, boostOne: event.target.value as AbilityKey })}>{background.abilities.map((ability) => <option key={ability} value={ability}>{abilityLabels[ability]}</option>)}</select></label></>}
              </fieldset>
            </div>
          )}

          {step === 2 && (
            <div className="builder-section">
              <div className="builder-copy"><h3>Choose class skills</h3><p>Your background already grants {background.skills.map(skillName).join(" and ")}. Choose {classData.skillCount} more from {classData.name}.</p></div>
              <div className="builder-skill-grid">
                {classSkills.map((id) => <label key={id} className={build.classSkills.includes(id) ? "selected" : ""}><input type="checkbox" checked={build.classSkills.includes(id)} onChange={() => toggleClassSkill(id)} /><span>{skillName(id)}</span></label>)}
              </div>
              <p className="builder-count">{build.classSkills.length} of {classData.skillCount} selected</p>
            </div>
          )}

          {step === 3 && (
            <div className="builder-section">
              <div className="builder-copy"><h3>Choose level-one features</h3><p>These choices will be written directly onto the finished sheet and remain editable.</p></div>
              <div className="builder-feature-overview">
                <article><span>{classData.name} features</span><ul>{classData.features.map((feature) => <li key={feature}>{feature}</li>)}</ul></article>
                <article><span>{species.name} traits</span><ul>{species.traits.map((trait) => <li key={trait}>{trait}</li>)}</ul></article>
              </div>
              {featureChoices.length > 0 ? (
                <div className="builder-choice-list">
                  {featureChoices.map((choice) => {
                    const selected = build.featureChoices[choice.id] ?? [];
                    return (
                      <fieldset className="builder-choice-card" key={choice.id}>
                        <legend>{choice.title}</legend>
                        <p>{choice.description}</p>
                        {choice.max === 1 ? (
                          <label className="builder-choice-select">Choice<select value={selected[0] ?? ""} onChange={(event) => setSingleFeatureChoice(choice, event.target.value)}><option value="" disabled>Choose an option</option>{choice.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>{choice.options.find((option) => option.value === selected[0])?.description}</small></label>
                        ) : (
                          <>
                            <div className="builder-choice-options">
                              {choice.options.map((option) => {
                                const checked = selected.includes(option.value);
                                return <label key={option.value} className={checked ? "selected" : ""}><input type="checkbox" checked={checked} disabled={!checked && selected.length >= choice.max} onChange={() => toggleFeatureChoice(choice, option.value)} /><span><b>{option.label}</b>{option.description && <small>{option.description}</small>}</span></label>;
                              })}
                            </div>
                            <p className="builder-count">{selected.length} of {choice.max} selected</p>
                          </>
                        )}
                      </fieldset>
                    );
                  })}
                </div>
              ) : <div className="builder-next-choices"><strong>No additional choices at level 1</strong><span>Your class and species features are ready to apply as shown.</span></div>}
            </div>
          )}

          {step === 4 && (
            <div className="builder-section">
              <div className="builder-copy"><h3>Ready for the table</h3><p>The builder will calculate HP, AC, saves, skills, spellcasting numbers, starting gear, and coins.</p></div>
              <div className="builder-review-grid">
                <article><span>Character</span><strong>{build.name || "Unnamed adventurer"}</strong><p>Level 1 {classData.name}<br />{species.name}{build.heritage ? ` (${build.heritage})` : ""}<br />{background.name}</p></article>
                <article><span>Ability scores</span><div className="builder-score-row">{abilityKeys.map((ability) => <b key={ability}><small>{ability.toUpperCase()}</small>{finalScores[ability]}</b>)}</div></article>
                <article><span>Proficiencies</span><p>{[...background.skills, ...build.classSkills].map(skillName).join(", ")}</p><p>{classData.weapons}</p></article>
                <article><span>Starting features</span><p>{classData.features.join(" · ")}</p><p>{species.traits.join(" · ")}</p><p>{featureSelections.map(({ title, labels }) => `${title}: ${labels.join(", ")}`).join(" · ")}</p><p>{background.feat}</p></article>
              </div>
              <div className="builder-next-choices"><strong>Finish on the sheet</strong><span>Choose spells and options unlocked at later levels after applying this level-one character.</span></div>
              {errors.length > 0 && <ul className="builder-errors">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
            </div>
          )}
        </div>

        <footer>
          <small>Built from your approved personal-use 2024 corpus, with options cross-checked through <a href="https://5e.tools/" target="_blank" rel="noreferrer">5e.tools</a>. Raw book text is not bundled.</small>
          <div><button disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</button>{step < steps.length - 1 ? <button className="builder-primary" onClick={() => setStep((value) => Math.min(steps.length - 1, value + 1))}>Next</button> : <button className="builder-primary" disabled={errors.length > 0} onClick={() => onApply(build)}>Apply to sheet</button>}</div>
        </footer>
      </section>
    </div>
  );
}

function rebalance(build: CharacterBuild, classData: (typeof builderClasses)[number], background: (typeof builderBackgrounds)[number]): CharacterBuild {
  const available = classSkillChoices(classData, background);
  const selected = build.classSkills.filter((skill) => available.includes(skill)).slice(0, classData.skillCount);
  for (const skill of available) if (selected.length < classData.skillCount && !selected.includes(skill)) selected.push(skill);
  const boostOrder = abilityKeys.filter((ability) => background.abilities.includes(ability)).sort((a, b) => classData.recommended[b] - classData.recommended[a]);
  return { ...build, classSkills: selected, boostTwo: boostOrder[0], boostOne: boostOrder[1] };
}

function skillName(id: SkillId): string {
  return skillDefinitions.find((skill) => skill.id === id)?.label ?? id;
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}
