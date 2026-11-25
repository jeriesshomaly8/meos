// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LATCH_WITHIN_MS, releaseOutcome, usePressToTalk } from "@/lib/voice/press-to-talk";

afterEach(cleanup);

/**
 * A button wired the way the capture sheet wires it, with the clock handed in
 * so a "hold" is a number rather than a wait.
 */
function Harness({
  now,
  onStart,
  onStop,
}: {
  now: () => number;
  onStart: () => void;
  onStop: () => void;
}) {
  const [listening, setListening] = useState(false);
  const handlers = usePressToTalk({
    listening,
    start: () => {
      onStart();
      setListening(true);
    },
    stop: () => {
      onStop();
      setListening(false);
    },
    now,
  });
  return <button type="button" data-testid="mic" aria-pressed={listening} {...handlers} />;
}

function setup() {
  let clock = 1_000;
  const onStart = vi.fn();
  const onStop = vi.fn();
  render(<Harness now={() => clock} onStart={onStart} onStop={onStop} />);
  const mic = screen.getByTestId("mic");
  return {
    onStart,
    onStop,
    mic,
    advance: (ms: number) => {
      clock += ms;
    },
    press: () => fireEvent.pointerDown(mic, { button: 0, pointerId: 1 }),
    release: () => fireEvent.pointerUp(mic, { button: 0, pointerId: 1 }),
    cancel: () => fireEvent.pointerCancel(mic, { pointerId: 1 }),
    click: () => fireEvent.click(mic),
  };
}

describe("releaseOutcome", () => {
  it("latches a press shorter than the threshold", () => {
    expect(releaseOutcome(0)).toBe("latch");
    expect(releaseOutcome(LATCH_WITHIN_MS - 1)).toBe("latch");
  });

  it("stops a press at or past the threshold", () => {
    expect(releaseOutcome(LATCH_WITHIN_MS)).toBe("stop");
    expect(releaseOutcome(5_000)).toBe("stop");
  });
});

describe("usePressToTalk", () => {
  it("starts listening the moment the press lands, not on release", () => {
    const { onStart, press } = setup();
    press();
    // Audio spoken immediately after the finger touches down would be lost if
    // the session only opened on release.
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("keeps listening after a quick tap, so the old toggle still works", () => {
    const { onStart, onStop, mic, advance, press, release, click } = setup();
    press();
    advance(120);
    release();
    click(); // the synthetic click every tap produces

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
    expect(mic).toHaveAttribute("aria-pressed", "true");
  });

  it("stops when a hold is released", () => {
    const { onStart, onStop, mic, advance, press, release } = setup();
    press();
    advance(1_500);
    release();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(mic).toHaveAttribute("aria-pressed", "false");
  });

  it("stops a latched session on the next tap", () => {
    const { onStop, mic, advance, press, release, click } = setup();
    press();
    advance(100);
    release();
    click();

    advance(2_000);
    press();
    expect(onStop).toHaveBeenCalledTimes(1);
    // The release of the closing press must not re-open anything.
    advance(90);
    release();
    click();

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(mic).toHaveAttribute("aria-pressed", "false");
  });

  it("treats a cancelled pointer as a release, so the mic never stays open", () => {
    const { onStop, mic, advance, press, cancel } = setup();
    press();
    advance(1_500);
    // A call, a scroll, the system stealing the gesture.
    cancel();

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(mic).toHaveAttribute("aria-pressed", "false");
  });

  it("ignores the click that echoes a pointer release", () => {
    const { onStart, onStop, advance, press, release, click } = setup();
    press();
    advance(1_500);
    release();
    expect(onStop).toHaveBeenCalledTimes(1);

    // Without echo suppression this click would immediately restart dictation.
    advance(10);
    click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("toggles on a keyboard activation, which sends no pointer events", () => {
    const { onStart, onStop, mic, click, advance } = setup();
    click();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(mic).toHaveAttribute("aria-pressed", "true");

    advance(3_000);
    click();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(mic).toHaveAttribute("aria-pressed", "false");
  });

  it("leaves the microphone alone for a secondary button", () => {
    const { onStart, mic } = setup();
    fireEvent.pointerDown(mic, { button: 2, pointerId: 1 });
    expect(onStart).not.toHaveBeenCalled();
  });
});
