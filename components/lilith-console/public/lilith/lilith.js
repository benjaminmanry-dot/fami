(function () {
  "use strict";

  const STORAGE_KEY = "lilith-sheet-state-v2";
  const BRIDGE_SOURCE = "lilith-sheet";
  const serializer = window.LilithRollSerializer;
  let inventoryFilter = "";
  let toastTimer = null;
  const pendingBridgeRequests = new Map();
  let lastSentCommand = "";
  let lastSentAt = 0;

  const BRIDGE_TIMEOUT_MS = 4000;
  const STATUS_MESSAGES = {
    "no-roll20-tab": "Open your Roll20 game in another Chrome tab, then try again.",
    "target-not-ready": "Found the Roll20 game tab—refresh it once so Lilith can connect, then retry.",
    "chat-input-not-found": "Open Roll20’s Text Chat panel, then try the roll again.",
    "submission-failed": "Roll20’s chat did not accept the command. Refresh the game tab and retry.",
    "invalid-request": "That roll could not be sent safely, so it was blocked.",
  };

  const DEFAULT_STATE = {
    version: 2,
    meta: {
      name: "Lilith",
      level: 6,
      className: "Berserker Barbarian",
      race: "Cubeling",
      background: "Experiment",
      alignment: "Chaotic Good",
      size: "Medium",
      rules: "2024 / 5e",
      quote: "A little sparkle, a little violence, and then snacks.",
    },
    vitals: {
      armorClass: 17,
      hpCurrent: 60,
      hpMax: 77,
      tempHp: 0,
      initiative: 2,
      speed: 40,
      passivePerception: 13,
      proficiency: 3,
      hitDiceCurrent: 6,
      hitDiceMax: 6,
      hitDie: "d12",
    },
    abilities: {
      str: { label: "Strength", short: "STR", score: 18, modifier: 4, save: 8, proficient: true },
      dex: { label: "Dexterity", short: "DEX", score: 14, modifier: 2, save: 3, proficient: false },
      con: { label: "Constitution", short: "CON", score: 16, modifier: 3, save: 7, proficient: true },
      int: { label: "Intelligence", short: "INT", score: 8, modifier: -1, save: 0, proficient: false },
      wis: { label: "Wisdom", short: "WIS", score: 14, modifier: 2, save: 3, proficient: false },
      cha: { label: "Charisma", short: "CHA", score: 8, modifier: -1, save: 0, proficient: false },
    },
    skills: [
      { id: "acrobatics", name: "Acrobatics", ability: "DEX", bonus: 3, proficient: false },
      { id: "animal-handling", name: "Animal Handling", ability: "WIS", bonus: 3, proficient: false },
      { id: "arcana", name: "Arcana", ability: "INT", bonus: 0, proficient: false },
      { id: "athletics", name: "Athletics", ability: "STR", bonus: 8, proficient: true },
      { id: "deception", name: "Deception", ability: "CHA", bonus: 0, proficient: false },
      { id: "history", name: "History", ability: "INT", bonus: 0, proficient: false },
      { id: "insight", name: "Insight", ability: "WIS", bonus: 6, proficient: true },
      { id: "intimidation", name: "Intimidation", ability: "CHA", bonus: 0, proficient: false },
      { id: "investigation", name: "Investigation", ability: "INT", bonus: 3, proficient: true },
      { id: "medicine", name: "Medicine", ability: "WIS", bonus: 3, proficient: false },
      { id: "nature", name: "Nature", ability: "INT", bonus: 0, proficient: false },
      { id: "perception", name: "Perception", ability: "WIS", bonus: 3, proficient: false },
      { id: "performance", name: "Performance", ability: "CHA", bonus: 0, proficient: false },
      { id: "persuasion", name: "Persuasion", ability: "CHA", bonus: 3, proficient: true },
      { id: "religion", name: "Religion", ability: "INT", bonus: 0, proficient: false },
      { id: "sleight-of-hand", name: "Sleight of Hand", ability: "DEX", bonus: 3, proficient: false },
      { id: "stealth", name: "Stealth", ability: "DEX", bonus: 6, proficient: true },
      { id: "survival", name: "Survival", ability: "WIS", bonus: 3, proficient: false },
    ],
    resources: [
      { id: "rage", name: "Rage", current: 2, max: 3, reset: "long", note: "10 minutes" },
      { id: "kawaii-ka-boom", name: "Kawaii Ka-BOOM", current: 0, max: 1, reset: "long", note: "Cubeling burst" },
      { id: "potion-healing", name: "Potion of Healing", current: 1, max: 1, reset: "none", note: "Consumable" },
      { id: "greater-potion", name: "Greater Potion", current: 1, max: 1, reset: "none", note: "Consumable" },
    ],
    attacks: [
      { id: "prism-scythe", name: "Prism Scythe +2", type: "Melee weapon", attackBonus: 9, damage: "2+6", damageType: "Slashing", ability: "str", rageEligible: true, notes: "Formula transcribed from Roll20" },
      { id: "prism-bonk", name: "Prism Bonk", type: "Melee weapon", attackBonus: 9, damage: "1d4+6", damageType: "Bludgeoning", ability: "str", rageEligible: true, notes: "Formula transcribed from Roll20" },
      { id: "prism-cleave", name: "Prism Cleave", type: "Melee weapon", attackBonus: 7, damage: "1d10", damageType: "Slashing", ability: "str", rageEligible: true, notes: "Formula transcribed from Roll20" },
      { id: "kawaii-ka-boom", name: "Kawaii Ka-BOOM", type: "Cubeling feature", attackBonus: 7, damage: "4", damageType: "Special", ability: "con", rageEligible: false, notes: "Custom feature; formula transcribed from Roll20" },
      { id: "slime-spike", name: "Slime Spike", type: "Cubeling weapon", attackBonus: 7, damage: "1d6+4", damageType: "Piercing", ability: "str", rageEligible: true, notes: "Formula transcribed from Roll20" },
      { id: "jeweled-warhammer-one-handed", name: "Shiny Jeweled Warhammer (1H)", type: "Melee weapon", attackBonus: 7, damage: "1d8+4", damageType: "Bludgeoning", ability: "str", rageEligible: true, notes: "One-handed formula from Roll20" },
      { id: "jeweled-warhammer-two-handed", name: "Shiny Jeweled Warhammer (2H)", type: "Melee weapon", attackBonus: 7, damage: "1d10+4", damageType: "Bludgeoning", ability: "str", rageEligible: true, notes: "Two-handed formula from Roll20" },
    ],
    features: [
      { id: "rage", name: "Rage", category: "Barbarian", action: "Bonus action", summary: "Enter a battle state that improves Lilith’s Strength-based violence and durability.", rollable: false },
      { id: "unarmored-defense", name: "Unarmored Defense", category: "Barbarian", action: "Passive", summary: "Lilith can turn Constitution and Dexterity into defense when she leaves the armor at home.", rollable: false },
      { id: "weapon-mastery", name: "Weapon Mastery", category: "Barbarian", action: "On hit", summary: "Masteries recorded on the source sheet: Warhammer and Halberd. Apply the relevant mastery property in play.", rollable: false },
      { id: "danger-sense", name: "Danger Sense", category: "Barbarian", action: "Passive", summary: "A shimmering instinct helps Lilith avoid danger she can see coming.", rollable: false },
      { id: "reckless-attack", name: "Reckless Attack", category: "Barbarian", action: "Attack", summary: "Trade safety for advantage on Strength attacks. The Combat tab applies this automatically.", rollable: false },
      { id: "primal-knowledge", name: "Primal Knowledge", category: "Barbarian", action: "While raging", summary: "Raw physicality carries Lilith through selected skill checks.", rollable: false },
      { id: "tough", name: "Tough", category: "Origin feat", action: "Passive", summary: "More hit points. More sparkle left after the impact.", rollable: false },
      { id: "amorphous-size", name: "Amorphous Size", category: "Cubeling", action: "Passive", summary: "Custom Cubeling feature. Use the campaign’s established rule text.", rollable: false, placeholder: true },
      { id: "viscous-skin", name: "Viscous Skin", category: "Cubeling", action: "Reaction", summary: "Custom Cubeling feature. Use the campaign’s established rule text.", rollable: false, placeholder: true },
      { id: "elastic-reach", name: "Elastic Reach", category: "Cubeling", action: "Passive", summary: "Custom Cubeling feature. Use the campaign’s established rule text.", rollable: false, placeholder: true },
      { id: "kawaii-ka-boom", name: "Kawaii Ka-BOOM", category: "Cubeling", action: "Action", summary: "Custom Cubeling action. The source sheet records +7 to hit and 4 damage.", rollable: true, roll: "4", placeholder: true },
      { id: "polearm-master", name: "Polearm Master", category: "Feat", action: "Bonus / reaction", summary: "Extra polearm pressure at close range and when foes enter Lilith’s reach.", rollable: false },
      { id: "sentinel", name: "Sentinel", category: "Feat", action: "Reaction", summary: "Punish movement and protect allies by making Lilith impossible to ignore.", rollable: false },
      { id: "frenzy", name: "Frenzy", category: "Berserker", action: "While raging", summary: "Turn reckless momentum into additional damage once each turn.", rollable: true, roll: "2d6" },
      { id: "mindless-rage", name: "Mindless Rage", category: "Berserker", action: "Passive", summary: "Rage makes Lilith extremely difficult to charm or frighten.", rollable: false },
    ],
    inventory: [
      { id: "warhammer", name: "Shiny Jeweled Warhammer", quantity: 1, weight: 2, category: "Weapon", equipped: false, notes: "Warhammer mastery; one- and two-handed attacks listed in Combat." },
      { id: "greatsword", name: "Greatsword", quantity: 1, weight: 6, category: "Weapon", equipped: false, notes: "Carried on the supplied Roll20 sheet." },
      { id: "jewelers-tools", name: "Jeweler’s Tools", quantity: 1, weight: 2, category: "Tool", equipped: false, notes: "Tool proficiency recorded on the supplied Roll20 sheet." },
      { id: "half-plate", name: "Half Plate", quantity: 1, weight: 45, category: "Armor", equipped: true, notes: "Current armor configuration." },
      { id: "shield", name: "Shield", quantity: 1, weight: 6, category: "Armor", equipped: false, notes: "Carried; not included in the supplied AC 17." },
      { id: "slime-spike", name: "Slime Spike", quantity: 10, weight: 0.2, category: "Weapon", equipped: false, notes: "Ten spikes; total listed weight 2 lb." },
      { id: "prism-scythe", name: "Prism Scythe +2", quantity: 1, weight: 6, category: "Weapon", equipped: true, notes: "Signature weapon." },
      { id: "dungeoneers-pack", name: "Dungeoneer’s Pack", quantity: 1, weight: 0, category: "Gear", equipped: false, notes: "Tracked as one pack on the supplied Roll20 sheet." },
      { id: "bottle-cozy", name: "Slime-Themed Bottle Cozy", quantity: 1, weight: 0, category: "Gear", equipped: false, notes: "Carried on the supplied Roll20 sheet." },
      { id: "potion", name: "Potion of Healing", quantity: 1, weight: 0.5, category: "Consumable", equipped: false, notes: "Tracked in Resources." },
      { id: "greater-potion", name: "Greater Potion of Healing", quantity: 1, weight: 0.5, category: "Consumable", equipped: false, notes: "Tracked in Resources." },
    ],
    coins: { cp: 9, sp: 7, ep: 0, gp: 1077, pp: 0 },
    toggles: { rage: false, reckless: false },
    deathSaves: { successes: 0, failures: 0 },
    settings: { activeTab: "overview", rollMode: "normal", whisper: false },
    journal: {
      appearance: "Iridescent pink-and-lilac cubeling with translucent candy-glass slime, jewel-bright highlights, crystalline alchemy bottles, dark leather straps, gold chains, and a smile that promises both cupcakes and structural damage.",
      personality: "Tough as nails and sweet as a cupcake. Lilith treats danger like a craft project: enthusiasm first, cleanup later.",
      notes: "Core numbers, attacks, resources, coins, and visible inventory were transcribed from the supplied Roll20 sheet. Full custom Cubeling rule text remains in the campaign’s established rules.",
    },
  };

  let state = clone(DEFAULT_STATE);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeDefaults(defaultValue, savedValue) {
    if (Array.isArray(defaultValue)) {
      return Array.isArray(savedValue) ? savedValue : clone(defaultValue);
    }
    if (defaultValue && typeof defaultValue === "object") {
      const output = {};
      const savedObject = savedValue && typeof savedValue === "object" ? savedValue : {};
      Object.keys(defaultValue).forEach((key) => {
        output[key] = mergeDefaults(defaultValue[key], savedObject[key]);
      });
      Object.keys(savedObject).forEach((key) => {
        if (!(key in output)) output[key] = savedObject[key];
      });
      return output;
    }
    return savedValue === undefined || savedValue === null ? defaultValue : savedValue;
  }

  function hasChromeStorage() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  async function loadState() {
    try {
      if (hasChromeStorage()) {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        return result[STORAGE_KEY] || null;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn("Lilith state could not be loaded", error);
      return null;
    }
  }

  async function saveState() {
    try {
      if (hasChromeStorage()) {
        await chrome.storage.local.set({ [STORAGE_KEY]: state });
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } catch (error) {
      showToast("The sheet could not save this change. Export a backup before closing.");
      console.warn("Lilith state could not be saved", error);
    }
  }

  function signed(value) {
    const number = Number(value) || 0;
    return number >= 0 ? `+${number}` : String(number);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
  }

  function setConnection(message, isError) {
    const pill = document.getElementById("connection-pill");
    const label = document.getElementById("connection-label");
    label.textContent = message;
    pill.classList.toggle("error", Boolean(isError));
  }

  function renderChrome() {
    document.querySelectorAll(".tab-button").forEach((button) => {
      const active = button.dataset.tab === state.settings.activeTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    document.querySelectorAll(".mode-button").forEach((button) => {
      const active = button.dataset.mode === state.settings.rollMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.getElementById("whisper-toggle").checked = state.settings.whisper;
    document.getElementById("character-name").textContent = state.meta.name;
    document.getElementById("character-subtitle").textContent = `Level ${state.meta.level} ${state.meta.className} • ${state.meta.race} • ${state.meta.alignment}`;
    document.querySelector(".character-banner blockquote").textContent = `“${state.meta.quote}”`;
    document.getElementById("rail-ac").textContent = state.vitals.armorClass;
    document.getElementById("rail-speed").textContent = `${state.vitals.speed} ft`;
    document.getElementById("rail-prof").textContent = signed(state.vitals.proficiency);
  }

  function renderDock() {
    const hpPercent = state.vitals.hpMax > 0 ? clamp((state.vitals.hpCurrent / state.vitals.hpMax) * 100, 0, 100) : 0;
    document.getElementById("hp-current").textContent = state.vitals.hpCurrent;
    document.getElementById("hp-max").textContent = state.vitals.hpMax;
    document.getElementById("hp-fill").style.width = `${hpPercent}%`;
    document.getElementById("temp-hp-input").value = state.vitals.tempHp;
    document.getElementById("resource-list").innerHTML = state.resources
      .map((resource) => {
        const percent = resource.max > 0 ? clamp((resource.current / resource.max) * 100, 0, 100) : 0;
        return `
          <div class="resource-row">
            <div class="resource-label">
              <strong>${escapeHtml(resource.name)}</strong>
              <small>${escapeHtml(resource.note)} • ${resource.reset === "none" ? "manual" : `${resource.reset} rest`}</small>
            </div>
            <div class="resource-stepper">
              <button type="button" data-resource-step="-1" data-resource-id="${escapeHtml(resource.id)}" aria-label="Spend ${escapeHtml(resource.name)}">−</button>
              <span>${resource.current} / ${resource.max}</span>
              <button type="button" data-resource-step="1" data-resource-id="${escapeHtml(resource.id)}" aria-label="Restore ${escapeHtml(resource.name)}">+</button>
            </div>
            <div class="resource-bar"><span style="width:${percent}%"></span></div>
          </div>`;
      })
      .join("");
  }

  function renderTab() {
    const target = document.getElementById("tab-content");
    const renderers = {
      overview: renderOverview,
      combat: renderCombat,
      features: renderFeatures,
      inventory: renderInventory,
      journal: renderJournal,
    };
    target.innerHTML = (renderers[state.settings.activeTab] || renderOverview)();
  }

  function renderAll() {
    renderChrome();
    renderDock();
    renderTab();
  }

  function vitalCard(label, value, note) {
    return `<div class="vital-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`;
  }

  function abilityCard(key, ability) {
    return `
      <div class="ability-card">
        <span class="ability-name">${escapeHtml(ability.label)}</span>
        <div class="ability-score"><strong>${ability.score}</strong><span>${signed(ability.modifier)}</span></div>
        <button type="button" class="roll-button" data-roll-kind="ability" data-roll-id="${key}" aria-label="Roll ${escapeHtml(ability.label)}">d20</button>
      </div>`;
  }

  function skillRow(skill) {
    return `
      <div class="skill-row">
        <span class="prof-dot ${skill.proficient ? "filled" : ""}" aria-hidden="true"></span>
        <div class="skill-name"><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(skill.ability)}</small></div>
        <span class="skill-bonus">${signed(skill.bonus)}</span>
        <button type="button" class="roll-button" data-roll-kind="skill" data-roll-id="${escapeHtml(skill.id)}">Roll</button>
      </div>`;
  }

  function renderOverview() {
    const signatureSkills = ["athletics", "insight", "investigation", "stealth", "persuasion", "perception"];
    const rage = state.resources.find((resource) => resource.id === "rage");
    return `
      <div class="content-grid">
        <section class="panel span-12" aria-labelledby="vitals-heading">
          <div class="panel-heading">
            <div><span class="eyebrow">Ready for trouble</span><h2 id="vitals-heading">Adventure vitals</h2></div>
            <span class="placeholder-ribbon">✦ Verified from Roll20</span>
          </div>
          <div class="vital-grid">
            ${vitalCard("Armor class", state.vitals.armorClass, "Half plate")}
            ${vitalCard("Initiative", signed(state.vitals.initiative), "Quick shimmer")}
            ${vitalCard("Speed", state.vitals.speed, "feet")}
            ${vitalCard("Passive Perception", state.vitals.passivePerception, "always watching")}
            ${vitalCard("Hit dice", `${state.vitals.hitDiceCurrent}${state.vitals.hitDie}`, `${state.vitals.hitDiceMax} maximum`)}
          </div>
        </section>

        <div class="overview-flow span-7">
          <section class="panel" aria-labelledby="abilities-heading">
            <div class="panel-heading">
              <div><span class="eyebrow">Click any gem to roll</span><h2 id="abilities-heading">Abilities</h2></div>
            </div>
            <div class="ability-grid">${Object.entries(state.abilities).map(([key, ability]) => abilityCard(key, ability)).join("")}</div>
          </section>

          <section class="panel" aria-labelledby="skills-heading">
            <div class="panel-heading">
              <div><span class="eyebrow">Signature sparkle</span><h2 id="skills-heading">Favorite skills</h2></div>
              <button type="button" class="soft-button" data-open-tab="journal">Sheet notes</button>
            </div>
            <div class="skill-list">${state.skills.filter((skill) => signatureSkills.includes(skill.id)).map(skillRow).join("")}</div>
          </section>
        </div>

        <div class="overview-flow span-5">
          <section class="panel" aria-labelledby="saves-heading">
            <div class="panel-heading">
              <div><span class="eyebrow">Keep the goo together</span><h2 id="saves-heading">Saving throws</h2></div>
            </div>
            <div class="skill-list">
              ${Object.entries(state.abilities).map(([key, ability]) => skillRow({ id: key, name: ability.label, ability: "Save", bonus: ability.save, proficient: ability.proficient }).replace('data-roll-kind="skill"', 'data-roll-kind="save"')).join("")}
            </div>
          </section>

          <section class="panel" aria-labelledby="status-heading">
            <div class="panel-heading">
              <div><span class="eyebrow">Sweet, soft, unstoppable</span><h2 id="status-heading">Battle temperament</h2></div>
            </div>
            <div class="summary-strip">
              <div class="summary-stat"><span>Rage</span><strong>${rage.current}/${rage.max}</strong></div>
              <div class="summary-stat"><span>Reach</span><strong>Elastic</strong></div>
              <div class="summary-stat"><span>Vibe</span><strong>Moe</strong></div>
              <div class="summary-stat"><span>Impact</span><strong>Bonk</strong></div>
            </div>
            <p class="panel-note">Resource totals stay visible in the right dock and are saved after every click.</p>
          </section>
        </div>
      </div>`;
  }

  function attackRow(attack) {
    return `
      <div class="attack-row">
        <div class="attack-name"><strong>${escapeHtml(attack.name)}</strong><small>${escapeHtml(attack.type)} • ${escapeHtml(attack.notes)}</small></div>
        <span class="attack-bonus">${signed(attack.attackBonus)} hit</span>
        <span class="attack-detail">${escapeHtml(attack.damage)} ${escapeHtml(attack.damageType)}</span>
        <button type="button" class="roll-button" data-roll-kind="attack" data-roll-id="${escapeHtml(attack.id)}">Roll</button>
      </div>`;
  }

  function renderCombat() {
    return `
      <div class="content-grid">
        <section class="panel span-12" aria-labelledby="combat-state-heading">
          <div class="panel-heading">
            <div><span class="eyebrow">Live modifiers</span><h2 id="combat-state-heading">Combat state</h2></div>
            <span class="placeholder-ribbon">Roll20 uses these toggles</span>
          </div>
          <div class="summary-strip">
            <button type="button" class="summary-stat table-button" data-action-toggle="rage" aria-pressed="${state.toggles.rage}"><span>Rage</span><strong>${state.toggles.rage ? "Active" : "Off"}</strong></button>
            <button type="button" class="summary-stat table-button" data-action-toggle="reckless" aria-pressed="${state.toggles.reckless}"><span>Reckless</span><strong>${state.toggles.reckless ? "Active" : "Off"}</strong></button>
            <div class="summary-stat"><span>Roll mode</span><strong>${escapeHtml(state.settings.rollMode)}</strong></div>
            <div class="summary-stat"><span>Rage damage</span><strong>${state.toggles.rage ? "+2" : "—"}</strong></div>
          </div>
        </section>

        <section class="panel span-12" aria-labelledby="attacks-heading">
          <div class="panel-heading">
            <div><span class="eyebrow">Roll20-powered</span><h2 id="attacks-heading">Attacks & actions</h2></div>
            <span class="tiny-badge">Public ${state.settings.whisper ? "off" : "on"}</span>
          </div>
          <div class="attack-list">${state.attacks.map(attackRow).join("")}</div>
        </section>

        <section class="panel span-6" aria-labelledby="hit-dice-heading">
          <div class="panel-heading">
            <div><span class="eyebrow">Short-rest recovery</span><h2 id="hit-dice-heading">Hit dice</h2></div>
          </div>
          <div class="summary-strip">
            <div class="summary-stat"><span>Remaining</span><strong>${state.vitals.hitDiceCurrent}</strong></div>
            <div class="summary-stat"><span>Die</span><strong>${state.vitals.hitDie}</strong></div>
            <button class="summary-stat table-button" type="button" data-roll-kind="hit-die"><span>Recover</span><strong>Roll</strong></button>
            <button class="summary-stat table-button" type="button" data-hit-die="1"><span>Restore</span><strong>+1</strong></button>
          </div>
        </section>

        <section class="panel span-6" aria-labelledby="death-saves-heading">
          <div class="panel-heading">
            <div><span class="eyebrow">When things get less cute</span><h2 id="death-saves-heading">Death saves</h2></div>
          </div>
          <div class="summary-strip">
            <button class="summary-stat table-button" type="button" data-death="success"><span>Successes</span><strong>${state.deathSaves.successes}/3</strong></button>
            <button class="summary-stat table-button" type="button" data-death="failure"><span>Failures</span><strong>${state.deathSaves.failures}/3</strong></button>
            <button class="summary-stat table-button" type="button" data-roll-kind="death-save"><span>Death save</span><strong>Roll</strong></button>
            <button class="summary-stat table-button" type="button" data-death="reset"><span>Clear</span><strong>Reset</strong></button>
          </div>
        </section>
      </div>`;
  }

  function featureRow(feature) {
    const badge = feature.placeholder ? "Custom rule reference" : feature.action;
    const roll = feature.rollable ? `<button type="button" class="roll-button" data-roll-kind="feature" data-roll-id="${escapeHtml(feature.id)}">Roll</button>` : `<span class="action-chip">${escapeHtml(badge)}</span>`;
    return `
      <article class="feature-row">
        <div class="feature-name"><strong>${escapeHtml(feature.name)}</strong><small>${escapeHtml(feature.category)} • ${escapeHtml(feature.action)}</small></div>
        <div class="feature-description">${escapeHtml(feature.summary)}</div>
        ${roll}
      </article>`;
  }

  function renderFeatures() {
    const categories = [...new Set(state.features.map((feature) => feature.category))];
    return `
      <div class="content-grid">
        <section class="panel span-12" aria-labelledby="features-heading">
          <div class="panel-heading">
            <div><span class="eyebrow">Built to take the hit</span><h2 id="features-heading">Features & traits</h2></div>
            <span class="placeholder-ribbon">✦ ${state.features.filter((feature) => feature.placeholder).length} custom rule references</span>
          </div>
          <div class="feature-list">
            ${categories.map((category) => state.features.filter((feature) => feature.category === category).map(featureRow).join("")).join("")}
          </div>
        </section>
      </div>`;
  }

  function inventoryRow(item) {
    return `
      <div class="inventory-row">
        <label class="equip-check" title="Equipped"><input type="checkbox" data-equip-item="${escapeHtml(item.id)}" ${item.equipped ? "checked" : ""} aria-label="Equip ${escapeHtml(item.name)}" /></label>
        <div class="inventory-name"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.notes || "No notes")}</small></div>
        <span class="item-category">${escapeHtml(item.category)}</span>
        <div class="quantity-stepper">
          <button type="button" data-item-quantity="-1" data-item-id="${escapeHtml(item.id)}" aria-label="Remove one ${escapeHtml(item.name)}">−</button>
          <span>${item.quantity}</span>
          <button type="button" data-item-quantity="1" data-item-id="${escapeHtml(item.id)}" aria-label="Add one ${escapeHtml(item.name)}">+</button>
        </div>
        <span class="item-weight">${Number(item.weight * item.quantity).toFixed(1)} lb</span>
        <button type="button" class="table-button" data-delete-item="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.name)}">×</button>
      </div>`;
  }

  function renderInventory() {
    const filtered = state.inventory.filter((item) => {
      const haystack = `${item.name} ${item.category} ${item.notes}`.toLowerCase();
      return haystack.includes(inventoryFilter.toLowerCase());
    });
    const totalWeight = state.inventory.reduce((sum, item) => sum + Number(item.weight || 0) * Number(item.quantity || 0), 0);
    const itemCount = state.inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    return `
      <div class="content-grid">
        <section class="panel span-12" aria-labelledby="inventory-heading">
          <div class="panel-heading">
            <div><span class="eyebrow">Every bottle and bonking tool</span><h2 id="inventory-heading">Inventory</h2></div>
            <button type="button" class="primary-button" id="add-item-button">+ Add item</button>
          </div>
          <div class="summary-strip">
            <div class="summary-stat"><span>Entries</span><strong>${state.inventory.length}</strong></div>
            <div class="summary-stat"><span>Total quantity</span><strong>${itemCount}</strong></div>
            <div class="summary-stat"><span>Tracked weight</span><strong>${totalWeight.toFixed(1)} lb</strong></div>
            <div class="summary-stat"><span>Equipped</span><strong>${state.inventory.filter((item) => item.equipped).length}</strong></div>
          </div>
        </section>

        <section class="panel span-12">
          <div class="inventory-toolbar">
            <input class="search-field" id="inventory-search" type="search" value="${escapeHtml(inventoryFilter)}" placeholder="Filter by item, category, or note…" aria-label="Filter inventory" />
            <span class="tiny-badge">${filtered.length} shown</span>
          </div>
          <div class="inventory-list">${filtered.length ? filtered.map(inventoryRow).join("") : `<div class="empty-state"><div><span>◇</span>No treasures match that filter.</div></div>`}</div>
        </section>

        <section class="panel span-6" aria-labelledby="coins-heading">
          <div class="panel-heading"><div><span class="eyebrow">Shiny things</span><h2 id="coins-heading">Coin purse</h2></div></div>
          <div class="coins-grid">
            ${Object.entries(state.coins).map(([coin, value]) => `<label class="coin-field">${coin}<input type="number" min="0" data-coin="${coin}" value="${value}" /></label>`).join("")}
          </div>
        </section>

        <section class="panel span-6" aria-labelledby="inventory-note-heading">
          <div class="panel-heading"><div><span class="eyebrow">Source-of-truth behavior</span><h2 id="inventory-note-heading">Inventory notes</h2></div></div>
          <p class="panel-note">Equipped state, quantities, weights, notes, and coins save locally. Consumable resources can be adjusted from the resource dock.</p>
        </section>
      </div>`;
  }

  function renderJournal() {
    return `
      <div class="content-grid">
        <section class="panel span-6" aria-labelledby="appearance-heading">
          <div class="panel-heading"><div><span class="eyebrow">Living gemstone</span><h2 id="appearance-heading">Appearance</h2></div></div>
          <label class="journal-field">Visual notes<textarea data-journal="appearance">${escapeHtml(state.journal.appearance)}</textarea></label>
        </section>
        <section class="panel span-6" aria-labelledby="personality-heading">
          <div class="panel-heading"><div><span class="eyebrow">Cupcake constitution</span><h2 id="personality-heading">Personality</h2></div></div>
          <label class="journal-field">Roleplay notes<textarea data-journal="personality">${escapeHtml(state.journal.personality)}</textarea></label>
        </section>
        <section class="panel span-8" aria-labelledby="notes-heading">
          <div class="panel-heading"><div><span class="eyebrow">At the table</span><h2 id="notes-heading">Character notes</h2></div><span class="placeholder-ribbon">Editable & autosaved</span></div>
          <label class="journal-field">Notes<textarea data-journal="notes">${escapeHtml(state.journal.notes)}</textarea></label>
        </section>
        <section class="panel span-4" aria-labelledby="backup-heading">
          <div class="panel-heading"><div><span class="eyebrow">Keep her safe</span><h2 id="backup-heading">Local backup</h2></div></div>
          <p class="panel-note">Export a JSON backup whenever Lilith gains a level or finishes a major shopping trip. Importing replaces the current local state.</p>
          <div class="tool-grid" style="margin-top:14px">
            <button type="button" class="soft-button" data-tool="export">Export</button>
            <button type="button" class="soft-button" data-tool="reset">Reset demo</button>
          </div>
        </section>
        <section class="panel span-12" aria-labelledby="connection-heading">
          <div class="panel-heading"><div><span class="eyebrow">Chrome bridge</span><h2 id="connection-heading">How rolls travel</h2></div></div>
          <p class="panel-note">Open a Roll20 game in another Chrome tab, then click a roll here. The extension finds the most recently active Roll20 game tab, enters the roll command into chat, and lets Roll20 evaluate the dice. Public is the default; the GM toggle adds a whisper prefix.</p>
        </section>
      </div>`;
  }

  // All Roll20 command text is assembled by the shared serializer, which
  // validates dice expressions and neutralizes template/command injection.
  function sendCard(title, fields) {
    const result = serializer.buildCard({
      name: state.meta.name,
      title,
      whisper: state.settings.whisper,
      fields,
    });
    if (!result.ok) {
      setConnection("Roll blocked", true);
      showToast(`${STATUS_MESSAGES["invalid-request"]} ${result.error}`);
      return;
    }
    sendRoll(result.command);
  }

  function signedExpression(base, modifier) {
    const value = Math.trunc(Number(modifier)) || 0;
    return `${base}${value >= 0 ? `+${value}` : value}`;
  }

  function rollCheck(label, modifier, detail, modeOverride) {
    const mode = modeOverride || state.settings.rollMode;
    sendCard(label, [
      ["Roll", { roll: serializer.d20Expression(modifier, mode) }],
      ["Mode", { text: mode }],
      ["Detail", { text: detail }],
    ]);
  }

  function handleRoll(kind, id) {
    if (kind === "ability") {
      const ability = state.abilities[id];
      if (ability) rollCheck(`${ability.label} Check`, ability.modifier, `${ability.short} ${signed(ability.modifier)}`);
      return;
    }
    if (kind === "save") {
      const ability = state.abilities[id];
      if (ability) rollCheck(`${ability.label} Save`, ability.save, ability.proficient ? "Proficient save" : "Saving throw");
      return;
    }
    if (kind === "skill") {
      const skill = state.skills.find((entry) => entry.id === id);
      if (skill) rollCheck(skill.name, skill.bonus, `${skill.ability}${skill.proficient ? " • Proficient" : ""}`);
      return;
    }
    if (kind === "attack") {
      const attack = state.attacks.find((entry) => entry.id === id);
      if (!attack) return;
      const mode = state.toggles.reckless && attack.ability === "str" ? "advantage" : state.settings.rollMode;
      const rageBonus = state.toggles.rage && attack.rageEligible ? "+2" : "";
      sendCard(attack.name, [
        ["Attack", { roll: serializer.d20Expression(attack.attackBonus, mode) }],
        ["Damage", { roll: `${attack.damage}${rageBonus}`, suffix: attack.damageType }],
        ["Mode", { text: mode }],
        ["Rage", { text: state.toggles.rage ? "Active" : "Off" }],
        ["Note", { text: attack.notes }],
      ]);
      return;
    }
    if (kind === "feature") {
      const feature = state.features.find((entry) => entry.id === id);
      if (!feature) return;
      sendCard(feature.name, [
        ["Result", feature.roll ? { roll: feature.roll } : { text: "Activated" }],
        ["Feature", { text: feature.summary }],
      ]);
      return;
    }
    if (kind === "hit-die") {
      if (state.vitals.hitDiceCurrent <= 0) {
        showToast("Lilith has no hit dice left to spend.");
        return;
      }
      state.vitals.hitDiceCurrent -= 1;
      saveState();
      renderAll();
      sendCard("Hit Die", [
        ["Recovery", { roll: signedExpression(`1${state.vitals.hitDie}`, state.abilities.con.modifier) }],
        ["Remaining", { text: String(state.vitals.hitDiceCurrent) }],
      ]);
      return;
    }
    if (kind === "death-save") {
      sendCard("Death Saving Throw", [
        ["Roll", { roll: "1d20" }],
        ["Stakes", { text: `${state.deathSaves.successes} successes • ${state.deathSaves.failures} failures` }],
      ]);
    }
  }

  async function sendRoll(command) {
    const now = Date.now();
    if (command === lastSentCommand && now - lastSentAt < 500) return; // ponytail: swallows accidental double-clicks, not deliberate rerolls
    lastSentCommand = command;
    lastSentAt = now;

    const requestId = `lilith-${now}-${Math.random().toString(16).slice(2)}`;
    setConnection("Sending to Roll20…", false);
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && location.protocol === "chrome-extension:") {
        const response = await chrome.runtime.sendMessage({ type: "LILITH_ROLL", command, requestId });
        handleBridgeResponse(response);
        return;
      }
      const timeout = setTimeout(() => {
        if (!pendingBridgeRequests.has(requestId)) return;
        pendingBridgeRequests.delete(requestId);
        handleBridgeResponse({ ok: false, error: "Open this sheet from the Lilith Chrome extension to send rolls." });
      }, BRIDGE_TIMEOUT_MS);
      pendingBridgeRequests.set(requestId, timeout);
      // targetOrigin stays "*": this message never leaves the sheet's own
      // window, and the sheet also runs from file:// where origin is opaque.
      // The bridge and the background re-validate origin authoritatively.
      window.postMessage({ source: BRIDGE_SOURCE, type: "LILITH_ROLL", command, requestId }, "*");
    } catch (error) {
      handleBridgeResponse({ ok: false, error: error && error.message ? error.message : "The Roll20 bridge did not answer." });
    }
  }

  function handleBridgeResponse(response) {
    if (response && response.ok) {
      // "Sent" means the command was submitted to Roll20's chat input.
      // Whether Roll20 evaluated the dice is visible only in the game log.
      const title = response.target && response.target.title
        ? String(response.target.title).replace(/\s*\|\s*Roll20.*$/i, "").trim().slice(0, 42)
        : "";
      setConnection(title ? `Sent to “${title}”` : "Command sent to Roll20", false);
      showToast("Roll command submitted to Roll20 chat.");
      return;
    }
    const status = response && response.status;
    const message = (status && STATUS_MESSAGES[status]) || (response && response.error) || "No active Roll20 game tab was found.";
    setConnection("Roll20 needs attention", true);
    showToast(message);
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `lilith-character-sheet-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast("Lilith’s backup has been exported.");
  }

  async function importBackup(file) {
    try {
      const imported = JSON.parse(await file.text());
      if (!imported || typeof imported !== "object" || !imported.meta || !imported.vitals) throw new Error("Not a Lilith sheet backup");
      state = mergeDefaults(DEFAULT_STATE, imported);
      await saveState();
      renderAll();
      showToast("Backup imported. Lilith is back in one piece.");
    } catch (error) {
      showToast("That file does not look like a valid Lilith backup.");
    }
  }

  function applyRest(type) {
    state.resources.forEach((resource) => {
      if (resource.reset === type || (type === "long" && resource.reset === "short")) resource.current = resource.max;
    });
    if (type === "long") {
      state.vitals.hpCurrent = state.vitals.hpMax;
      state.vitals.tempHp = 0;
      state.vitals.hitDiceCurrent = state.vitals.hitDiceMax;
      state.deathSaves.successes = 0;
      state.deathSaves.failures = 0;
      state.toggles.rage = false;
      state.toggles.reckless = false;
    }
    saveState();
    renderAll();
    showToast(type === "long" ? "Long rest complete. Maximum sparkle restored." : "Short rest complete. Short-rest resources restored.");
  }

  function addInventoryItem(form) {
    const data = new FormData(form);
    const item = {
      id: `item-${Date.now()}`,
      name: String(data.get("name") || "New item").trim(),
      quantity: Math.max(0, Number(data.get("quantity")) || 0),
      weight: Math.max(0, Number(data.get("weight")) || 0),
      category: String(data.get("category") || "Gear"),
      equipped: data.get("equipped") === "on",
      notes: String(data.get("notes") || "").trim(),
    };
    state.inventory.push(item);
    saveState();
    form.reset();
    renderTab();
    showToast(`${item.name} added to Lilith’s pack.`);
  }

  function bindStaticEvents() {
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => {
        state.settings.activeTab = button.dataset.tab;
        saveState();
        renderAll();
      });
    });

    document.querySelectorAll(".mode-button").forEach((button) => {
      button.addEventListener("click", () => {
        state.settings.rollMode = button.dataset.mode;
        saveState();
        renderChrome();
        if (state.settings.activeTab === "combat") renderTab();
      });
    });

    document.getElementById("whisper-toggle").addEventListener("change", (event) => {
      state.settings.whisper = event.target.checked;
      saveState();
      if (state.settings.activeTab === "combat") renderTab();
    });

    document.getElementById("test-roll-button").addEventListener("click", () => {
      rollCheck("Connection Test", 0, "If this appears, Lilith is connected.");
    });

    document.getElementById("export-button").addEventListener("click", exportBackup);
    document.getElementById("import-file").addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];
      if (file) importBackup(file);
      event.target.value = "";
    });

    document.querySelector(".hp-controls").addEventListener("click", (event) => {
      const button = event.target.closest("[data-hp]");
      if (!button) return;
      state.vitals.hpCurrent = clamp(state.vitals.hpCurrent + Number(button.dataset.hp), 0, state.vitals.hpMax);
      saveState();
      renderDock();
    });

    document.getElementById("temp-hp-input").addEventListener("change", (event) => {
      state.vitals.tempHp = Math.max(0, Number(event.target.value) || 0);
      saveState();
      renderDock();
    });

    document.getElementById("resource-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-resource-step]");
      if (!button) return;
      const resource = state.resources.find((entry) => entry.id === button.dataset.resourceId);
      if (!resource) return;
      resource.current = clamp(resource.current + Number(button.dataset.resourceStep), 0, resource.max);
      saveState();
      renderDock();
      if (state.settings.activeTab === "overview") renderTab();
    });

    document.getElementById("short-rest-button").addEventListener("click", () => applyRest("short"));
    document.getElementById("long-rest-button").addEventListener("click", () => applyRest("long"));

    const itemDialog = document.getElementById("item-dialog");
    const itemForm = document.getElementById("item-form");
    document.getElementById("cancel-item-button").addEventListener("click", () => itemDialog.close());
    itemForm.addEventListener("submit", (event) => {
      event.preventDefault();
      addInventoryItem(itemForm);
      itemDialog.close();
    });

    document.getElementById("tab-content").addEventListener("click", (event) => {
      const rollButton = event.target.closest("[data-roll-kind]");
      if (rollButton) {
        handleRoll(rollButton.dataset.rollKind, rollButton.dataset.rollId);
        return;
      }

      const openTabButton = event.target.closest("[data-open-tab]");
      if (openTabButton) {
        state.settings.activeTab = openTabButton.dataset.openTab;
        saveState();
        renderAll();
        return;
      }

      const toggleButton = event.target.closest("[data-action-toggle]");
      if (toggleButton) {
        const key = toggleButton.dataset.actionToggle;
        state.toggles[key] = !state.toggles[key];
        saveState();
        renderAll();
        showToast(`${key === "rage" ? "Rage" : "Reckless Attack"} ${state.toggles[key] ? "activated" : "cleared"}.`);
        return;
      }

      const hitDieButton = event.target.closest("[data-hit-die]");
      if (hitDieButton) {
        state.vitals.hitDiceCurrent = clamp(state.vitals.hitDiceCurrent + Number(hitDieButton.dataset.hitDie), 0, state.vitals.hitDiceMax);
        saveState();
        renderTab();
        return;
      }

      const deathButton = event.target.closest("[data-death]");
      if (deathButton) {
        if (deathButton.dataset.death === "reset") {
          state.deathSaves.successes = 0;
          state.deathSaves.failures = 0;
        } else {
          const key = deathButton.dataset.death === "success" ? "successes" : "failures";
          state.deathSaves[key] = clamp(state.deathSaves[key] + 1, 0, 3);
        }
        saveState();
        renderTab();
        return;
      }

      const addItemButton = event.target.closest("#add-item-button");
      if (addItemButton) {
        itemDialog.showModal();
        return;
      }

      const quantityButton = event.target.closest("[data-item-quantity]");
      if (quantityButton) {
        const item = state.inventory.find((entry) => entry.id === quantityButton.dataset.itemId);
        if (item) item.quantity = Math.max(0, Number(item.quantity) + Number(quantityButton.dataset.itemQuantity));
        saveState();
        renderTab();
        return;
      }

      const deleteButton = event.target.closest("[data-delete-item]");
      if (deleteButton) {
        const item = state.inventory.find((entry) => entry.id === deleteButton.dataset.deleteItem);
        if (item && window.confirm(`Remove ${item.name} from Lilith’s inventory?`)) {
          state.inventory = state.inventory.filter((entry) => entry.id !== item.id);
          saveState();
          renderTab();
        }
        return;
      }

      const toolButton = event.target.closest("[data-tool]");
      if (toolButton) {
        if (toolButton.dataset.tool === "export") exportBackup();
        if (toolButton.dataset.tool === "reset" && window.confirm("Reset the local sheet to the current demo data? Export a backup first if needed.")) {
          state = clone(DEFAULT_STATE);
          saveState();
          renderAll();
          showToast("Demo data restored.");
        }
      }
    });

    document.getElementById("tab-content").addEventListener("input", (event) => {
      const search = event.target.closest("#inventory-search");
      if (search) {
        inventoryFilter = search.value;
        renderTab();
        const replacement = document.getElementById("inventory-search");
        replacement.focus();
        replacement.setSelectionRange(replacement.value.length, replacement.value.length);
        return;
      }
      const journal = event.target.closest("[data-journal]");
      if (journal) {
        state.journal[journal.dataset.journal] = journal.value;
        saveState();
      }
    });

    document.getElementById("tab-content").addEventListener("change", (event) => {
      const equip = event.target.closest("[data-equip-item]");
      if (equip) {
        const item = state.inventory.find((entry) => entry.id === equip.dataset.equipItem);
        if (item) item.equipped = equip.checked;
        saveState();
        renderTab();
        return;
      }
      const coin = event.target.closest("[data-coin]");
      if (coin) {
        state.coins[coin.dataset.coin] = Math.max(0, Number(coin.value) || 0);
        saveState();
      }
    });

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const message = event.data;
      if (!message || message.source !== "lilith-extension" || message.type !== "LILITH_ROLL_RESULT") return;
      // Only requests this sheet still has in flight are handled; duplicate
      // or unknown acknowledgements are dropped instead of double-toasting.
      if (!pendingBridgeRequests.has(message.requestId)) return;
      clearTimeout(pendingBridgeRequests.get(message.requestId));
      pendingBridgeRequests.delete(message.requestId);
      handleBridgeResponse(message.response);
    });
  }

  async function initialize() {
    const saved = await loadState();
    if (saved) state = mergeDefaults(DEFAULT_STATE, saved);
    bindStaticEvents();
    renderAll();
    // The label names the active storage runtime: the extension page keeps
    // its own character record in chrome.storage.local; every other context
    // saves to this browser profile's localStorage.
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && location.protocol === "chrome-extension:") {
      setConnection("Bridge ready • extension storage", false);
    } else {
      setConnection("Offline sheet • browser storage", false);
    }
  }

  initialize();
})();
