// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { joinSpoken, useDictation } from "@/lib/voice/dictation";

/**
 * The Web Speech API is driven by a fake here rather than mocked away: the
 * behaviour worth testing is what this hook does *around* the browser — the
 * restart after the silence timeout, committing only final phrases, and telling
 * a blocked microphone apart from a quiet one.
 */

interface SpokenChunk {
  transcript: string;
  isFinal: boolean;
}

/** Shaped like a `SpeechRecognitionResultList`: indexed, with `length`. */
function resultsFrom(chunks: SpokenChunk[]) {
  const list: Record<number, unknown> & { length: number } = { length: chunks.length };
  chunks.forEach((chunk, index) => {
    list[index] = { isFinal: chunk.isFinal, length: 1, 0: { transcript: chunk.transcript } };
  });
  return list;
}

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 0;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  aborted = false;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {
    this.starts += 1;
  }

  stop() {
    this.onend?.();
  }

  abort() {
    this.aborted = true;
  }

  say(chunks: SpokenChunk[], resultIndex = 0) {
    this.onresult?.({ resultIndex, results: resultsFrom(chunks) });
  }

  fail(error: string) {
    this.onerror?.({ error, message: "" });
  }

  /** What the browser does after a few seconds of quiet. */
  timeOut() {
    this.onend?.();
  }
}

const latest = () => FakeRecognition.instances.at(-1)!;

function Harness({ onText = () => {} }: { onText?: (chunk: string) => void }) {
  const dictation = useDictation({ onText });
  return (
    <div>
      <span data-testid="status">{dictation.status}</span>
      <span data-testid="interim">{dictation.interim}</span>
      <span data-testid="error">{dictation.error ?? ""}</span>
      <button type="button" onClick={dictation.start}>
        start
      </button>
      <button type="button" onClick={dictation.stop}>
        stop
      </button>
    </div>
  );
}

const status = () => screen.getByTestId("status").textContent;

beforeEach(() => {
  FakeRecognition.instances = [];
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe("joinSpoken", () => {
  it("starts a capture as a sentence", () => {
    expect(joinSpoken("", "sarah's birthday is in september")).toBe(
      "Sarah's birthday is in september",
    );
  });

  it("separates phrases the browser hands over unspaced", () => {
    expect(joinSpoken("Sarah's birthday is in September", "and she loves white flowers")).toBe(
      "Sarah's birthday is in September and she loves white flowers",
    );
  });

  it("respects a space the user typed themselves", () => {
    expect(joinSpoken("Remind me ", "on Tuesday")).toBe("Remind me on Tuesday");
  });

  it("ignores an empty phrase", () => {
    expect(joinSpoken("Buy milk", "   ")).toBe("Buy milk");
  });
});

describe("useDictation", () => {
  it("hides itself when the browser has no speech API", () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    render(<Harness />);
    expect(status()).toBe("unsupported");
  });

  it("is idle until asked to listen", () => {
    render(<Harness />);
    expect(status()).toBe("idle");
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it("commits final phrases and only shows the rest", async () => {
    const onText = vi.fn();
    const user = userEvent.setup();
    render(<Harness onText={onText} />);
    await user.click(screen.getByText("start"));
    expect(status()).toBe("listening");

    act(() => latest().say([{ transcript: "wake me up tomorrow", isFinal: false }]));
    expect(screen.getByTestId("interim")).toHaveTextContent("wake me up tomorrow");
    expect(onText).not.toHaveBeenCalled();

    act(() => latest().say([{ transcript: "wake me up tomorrow at 7am", isFinal: true }]));
    expect(onText).toHaveBeenCalledWith("wake me up tomorrow at 7am");
    expect(screen.getByTestId("interim")).toBeEmptyDOMElement();
  });

  it("asks the browser for continuous results, in the user's language", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("start"));
    expect(latest().continuous).toBe(true);
    expect(latest().interimResults).toBe(true);
    expect(latest().lang).toBeTruthy();
  });

  it("keeps listening through the browser's silence timeout", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("start"));

    act(() => latest().timeOut());
    // Same session restarted rather than a new one: "listening" has to mean it.
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(latest().starts).toBe(2);
    expect(status()).toBe("listening");
  });

  it("treats silence as silence, not as an error", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("start"));

    act(() => latest().fail("no-speech"));
    act(() => latest().timeOut());
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
    expect(status()).toBe("listening");
  });

  it("lets go of the microphone after a long silence", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("start"));

    for (let i = 0; i < 21; i += 1) act(() => latest().timeOut());
    expect(status()).toBe("idle");
  });

  it("stops for good when the user stops it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("start"));
    await user.click(screen.getByText("stop"));

    expect(status()).toBe("idle");
    act(() => latest().timeOut());
    expect(latest().starts).toBe(1);
    expect(status()).toBe("idle");
  });

  it("explains a blocked microphone instead of failing quietly", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("start"));

    act(() => latest().fail("not-allowed"));
    expect(status()).toBe("denied");
    expect(screen.getByTestId("error")).toHaveTextContent(/site settings/i);
  });

  it("names the connection when the speech service is unreachable", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("start"));

    act(() => latest().fail("network"));
    expect(status()).toBe("error");
    expect(screen.getByTestId("error")).toHaveTextContent(/connection/i);
  });

  it("releases the microphone when the sheet goes away", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await user.click(screen.getByText("start"));
    unmount();
    expect(latest().aborted).toBe(true);
  });
});
