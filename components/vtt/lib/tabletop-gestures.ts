export type CameraGestureRegion = "map" | "table-margin" | "interface";

export type CameraPanStart = {
  button: number;
  panToolActive: boolean;
  region: CameraGestureRegion;
};

export function shouldBeginCameraPan({
  button,
  panToolActive,
  region,
}: CameraPanStart): boolean {
  if (region === "interface") return false;
  return button === 1 || button === 2 || (button === 0 && panToolActive);
}
