import { TranscriptionStatus } from "@/components/TranscriptionStatus";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("TranscriptionStatus", () => {
  it("renders nothing when neither marker is present", () => {
    const { container } = render(<TranscriptionStatus content="plain note body" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 'Transcribing…' when the note still carries the pending marker", () => {
    render(
      <TranscriptionStatus content="# 🎙️ Voice memo\n\n_Transcript pending._\n" />,
    );
    expect(screen.getByText(/transcribing/i)).toBeInTheDocument();
  });

  it("shows the unavailable chip when the note carries the unavailable marker", () => {
    render(
      <TranscriptionStatus
        content="Some preamble.\n\n_Transcription unavailable._\n\nrest"
      />,
    );
    expect(screen.getByText(/transcription unavailable/i)).toBeInTheDocument();
  });

  it("prefers the pending chip when both markers coexist", () => {
    render(
      <TranscriptionStatus content="_Transcript pending._\n_Transcription unavailable._" />,
    );
    expect(screen.getByText(/transcribing/i)).toBeInTheDocument();
    expect(screen.queryByText(/transcription unavailable/i)).not.toBeInTheDocument();
  });
});
