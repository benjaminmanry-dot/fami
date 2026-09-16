import { classifyScene } from './classifier.js';
import { isScene } from './scenes.js';

export class SceneDirector {
  constructor(options = {}) {
    this.minConsecutive = options.minConsecutive ?? 2;
    this.minDwellMs = options.minDwellMs ?? 8_000;
    this.clock = options.clock ?? (() => Date.now());
    this.reset();
  }

  reset() {
    this.active = true;
    this.held = false;
    this.currentScene = 'quiet';
    this.candidateScene = null;
    this.candidateCount = 0;
    this.lastChangedAt = 0;
    this.lastClassification = null;
    this.lastReason = 'ready';
  }

  snapshot() {
    return {
      active: this.active,
      held: this.held,
      currentScene: this.currentScene,
      candidateScene: this.candidateScene,
      candidateCount: this.candidateCount,
      lastChangedAt: this.lastChangedAt,
      lastClassification: this.lastClassification,
      lastReason: this.lastReason
    };
  }

  ingest(text, at = this.clock()) {
    const classification = classifyScene(text);
    this.lastClassification = classification;

    if (!this.active) {
      this.lastReason = 'DJ is stopped';
      return { changed: false, classification, state: this.snapshot() };
    }

    if (this.held) {
      this.lastReason = 'manual hold is active';
      return { changed: false, classification, state: this.snapshot() };
    }

    if (!classification.scene) {
      if (classification.reason !== 'silence') {
        this.candidateScene = null;
        this.candidateCount = 0;
      }
      this.lastReason = classification.reason;
      return { changed: false, classification, state: this.snapshot() };
    }

    if (classification.scene === this.currentScene) {
      this.candidateScene = null;
      this.candidateCount = 0;
      this.lastReason = `already in ${classification.scene}`;
      return { changed: false, classification, state: this.snapshot() };
    }

    if (classification.force) {
      return this.#change(classification.scene, classification.reason, classification, at);
    }

    if (classification.scene === this.candidateScene) {
      this.candidateCount += 1;
    } else {
      this.candidateScene = classification.scene;
      this.candidateCount = 1;
    }

    const stable = this.candidateCount >= this.minConsecutive;
    const dwellComplete = this.lastChangedAt === 0 || at - this.lastChangedAt >= this.minDwellMs;
    if (stable && dwellComplete) {
      return this.#change(classification.scene, 'sustained scene evidence', classification, at);
    }

    this.lastReason = stable ? 'waiting for transition cooldown' : 'waiting for a confirming cue';
    return { changed: false, classification, state: this.snapshot() };
  }

  override(scene, at = this.clock()) {
    if (!isScene(scene)) throw new Error(`Unknown scene: ${scene}`);
    this.active = true;
    this.held = true;
    return this.#change(scene, 'manual override; auto-DJ held', null, at);
  }

  hold() {
    this.held = true;
    this.lastReason = 'manual hold is active';
    return this.snapshot();
  }

  resume() {
    this.active = true;
    this.held = false;
    this.candidateScene = null;
    this.candidateCount = 0;
    this.lastReason = 'automatic scene changes resumed';
    return this.snapshot();
  }

  stop() {
    this.active = false;
    this.held = true;
    this.candidateScene = null;
    this.candidateCount = 0;
    this.lastClassification = null;
    this.lastReason = 'DJ stopped';
    return this.snapshot();
  }

  start() {
    this.active = true;
    this.held = false;
    this.lastReason = 'DJ started';
    return this.snapshot();
  }

  #change(scene, reason, classification, at) {
    const previousScene = this.currentScene;
    this.currentScene = scene;
    this.lastChangedAt = at;
    this.candidateScene = null;
    this.candidateCount = 0;
    this.lastReason = reason;
    return {
      changed: previousScene !== scene,
      previousScene,
      classification,
      state: this.snapshot()
    };
  }
}
