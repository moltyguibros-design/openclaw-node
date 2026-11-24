import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { startSpectrum } from "../spectrum-loop";

afterEach(() => vi.unstubAllGlobals());

function stubFrames() {
  let next = 0;
  const raf = vi.fn((_cb: FrameRequestCallback) => ++next);
  const caf = vi.fn();
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", caf);
  return { raf, caf };
}

it("paints the idle bars once and schedules no frames", () => {
  const { raf } = stubFrames();
  const draw = vi.fn();
  startSpectrum(draw, false);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(raf).not.toHaveBeenCalled();
});

it("keeps a frame loop only while animating, and stops it", () => {
  const { raf, caf } = stubFrames();
  const draw = vi.fn();
  const stop = startSpectrum(draw, true);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(raf).toHaveBeenCalledTimes(1);
  (raf.mock.calls[0][0] as () => void)();
  expect(draw).toHaveBeenCalledTimes(2);
  expect(raf).toHaveBeenCalledTimes(2);
  stop();
  expect(caf).toHaveBeenCalledWith(2);
});

it("the component runs its draw through the scheduler and repaints after a resize clears the canvas", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../components/live/audio-spectrum.tsx"), "utf8");
  expect(src).toContain("startSpectrum(drawFrame, !!(analyser && isSpeaking))");
  expect(src).not.toMatch(/requestAnimationFrame\(draw\)/);
  const resize = src.slice(src.indexOf("new ResizeObserver"));
  expect(resize).toMatch(/canvas\.height = [^\n]*\n\s*drawRef\.current\?\.\(\);/);
});
