"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";

type TokenTheme = "classic" | "bloom" | "dragonfire" | "arcane";

export function TokenMaker({
  name,
  onSave,
  onClose,
}: {
  name: string;
  onSave(file: File): Promise<void>;
  onClose(): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [portrait, setPortrait] = useState<File | null>(null);
  const [theme, setTheme] = useState<TokenTheme>("classic");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Choose a portrait, then pick a border.");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void drawToken(canvas, portrait, theme, name);
  }, [name, portrait, theme]);

  function choosePortrait(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    setPortrait(file);
    setMessage(file ? "Preview ready." : "Choose a portrait, then pick a border.");
  }

  async function save() {
    const canvas = canvasRef.current;
    if (!canvas || !portrait) {
      setMessage("Choose a portrait first.");
      return;
    }
    setBusy(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not create token.")), "image/png"),
      );
      await onSave(new File([blob], `${safeName(name)}-${theme}-token.png`, { type: "image/png" }));
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save token.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="token-maker-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="token-maker" role="dialog" aria-modal="true" aria-labelledby="token-maker-title">
        <header><div><span>Free static token studio</span><h2 id="token-maker-title">Make {name}&apos;s token</h2></div><button aria-label="Close token maker" onClick={onClose}>×</button></header>
        <canvas ref={canvasRef} width="512" height="512" aria-label="Token preview" />
        <label className="file-picker">Choose portrait<input type="file" accept="image/png,image/jpeg,image/webp" onChange={choosePortrait} /></label>
        <label>Border
          <select value={theme} onChange={(event) => setTheme(event.target.value as TokenTheme)}>
            <option value="classic">Classic gold</option>
            <option value="bloom">Druid bloom</option>
            <option value="dragonfire">Dragonfire</option>
            <option value="arcane">Arcane sigils</option>
          </select>
        </label>
        <output aria-live="polite">{message}</output>
        <footer><button onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !portrait} onClick={() => void save()}>{busy ? "Saving…" : "Use this token"}</button></footer>
      </div>
    </section>
  );
}

async function drawToken(
  canvas: HTMLCanvasElement,
  portrait: File | null,
  theme: TokenTheme,
  name: string,
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, 512, 512);
  context.save();
  context.beginPath();
  context.arc(256, 256, 206, 0, Math.PI * 2);
  context.clip();
  if (portrait) {
    const bitmap = await createImageBitmap(portrait);
    try {
      const scale = Math.max(412 / bitmap.width, 412 / bitmap.height);
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      context.drawImage(bitmap, 256 - width / 2, 256 - height / 2, width, height);
    } finally {
      bitmap.close();
    }
  } else {
    const fill = context.createLinearGradient(70, 70, 442, 442);
    fill.addColorStop(0, "#4b5367");
    fill.addColorStop(1, "#161a23");
    context.fillStyle = fill;
    context.fillRect(0, 0, 512, 512);
    context.fillStyle = "#fff";
    context.font = "900 128px system-ui";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(initials(name), 256, 256);
  }
  context.restore();
  drawBorder(context, theme);
}

function drawBorder(context: CanvasRenderingContext2D, theme: TokenTheme) {
  const palettes: Record<TokenTheme, [string, string, string]> = {
    classic: ["#6f4514", "#f4d783", "#fff3b3"],
    bloom: ["#194b35", "#77c75a", "#f3a8c7"],
    dragonfire: ["#5c120a", "#f04b1f", "#ffd15c"],
    arcane: ["#24154d", "#7c69ff", "#73e5ff"],
  };
  const [dark, middle, bright] = palettes[theme];
  context.save();
  context.translate(256, 256);
  if (theme === "bloom") {
    for (let index = 0; index < 28; index += 1) {
      context.save();
      context.rotate(index / 28 * Math.PI * 2);
      context.fillStyle = index % 2 ? middle : bright;
      context.beginPath();
      context.ellipse(0, -229, 12, 28, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  } else if (theme === "dragonfire") {
    for (let index = 0; index < 34; index += 1) {
      context.save();
      context.rotate(index / 34 * Math.PI * 2);
      const height = 22 + index % 3 * 7;
      context.fillStyle = index % 2 ? middle : bright;
      context.beginPath();
      context.moveTo(-9, -220);
      context.quadraticCurveTo(0, -220 - height, 9, -220);
      context.closePath();
      context.fill();
      context.restore();
    }
  } else if (theme === "arcane") {
    context.strokeStyle = bright;
    context.lineWidth = 4;
    for (let index = 0; index < 16; index += 1) {
      context.save();
      context.rotate(index / 16 * Math.PI * 2);
      context.strokeRect(-6, -241, 12, 12);
      context.restore();
    }
  }
  const ring = context.createRadialGradient(0, 0, 204, 0, 0, 252);
  ring.addColorStop(0, "transparent");
  ring.addColorStop(0.02, bright);
  ring.addColorStop(0.28, middle);
  ring.addColorStop(0.78, dark);
  ring.addColorStop(1, "transparent");
  context.fillStyle = ring;
  context.beginPath();
  context.arc(0, 0, 252, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = bright;
  context.lineWidth = 5;
  context.beginPath();
  context.arc(0, 0, 207, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function safeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "character";
}
