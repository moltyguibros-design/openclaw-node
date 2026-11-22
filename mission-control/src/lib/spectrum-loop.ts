export function startSpectrum(drawFrame: () => void, animate: boolean): () => void {
  let id = 0;
  const tick = () => {
    drawFrame();
    if (animate) id = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(id);
}
