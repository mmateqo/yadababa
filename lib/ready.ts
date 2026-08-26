/* ============================================================================
   The GPU signal.

   There is no preloader. The first second and a half of black and stars is what
   covers the load — and covering it only works if the planet does not appear
   until it is genuinely ready to be drawn. This resolves once the Earth's three
   shells have been drawn at least once, invisibly, which links their programs
   and uploads their maps.

   Nothing waits on it to START the film; the film starts on the first frame.
   It exists so the Earth's own reveal can hold until there is something to
   reveal, and so a shader compile never lands inside the approach.
   ========================================================================== */

let resolveGpu: (() => void) | null = null;
let done = false;
const gpu = new Promise<void>((r) => {
  resolveGpu = r;
});

export function markGpuReady() {
  if (done) return;
  done = true;
  resolveGpu?.();
}

export const whenGpuReady = () => gpu;
export const isGpuReady = () => done;
