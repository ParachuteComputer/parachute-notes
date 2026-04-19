import { TagRenameDialog } from "@/components/TagRenameDialog";
import { VaultAuthError, VaultTargetExistsError } from "@/lib/vault/client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("TagRenameDialog", () => {
  it("rename: happy path toasts and closes", async () => {
    const onRun = vi.fn().mockResolvedValue({ renamed: 4 });
    const onClose = vi.fn();
    render(
      <TagRenameDialog
        mode="rename"
        sources={["work"]}
        tagOptions={["work", "projects"]}
        onClose={onClose}
        onRun={onRun}
        onRunMerge={vi.fn()}
        pending={false}
        offline={false}
      />,
    );
    fireEvent.change(screen.getByLabelText(/new tag name/i), {
      target: { value: "projects" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(onRun).toHaveBeenCalledWith("projects"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("rename: 409 target_exists surfaces a 'Merge into #target' affordance", async () => {
    const onRun = vi.fn().mockRejectedValue(new VaultTargetExistsError("projects"));
    const onRunMerge = vi.fn().mockResolvedValue({
      merged: { work: 5 },
      target: "projects",
    });
    const onClose = vi.fn();
    render(
      <TagRenameDialog
        mode="rename"
        sources={["work"]}
        tagOptions={["work", "projects"]}
        onClose={onClose}
        onRun={onRun}
        onRunMerge={onRunMerge}
        pending={false}
        offline={false}
      />,
    );
    fireEvent.change(screen.getByLabelText(/new tag name/i), {
      target: { value: "projects" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    const mergeButton = await screen.findByRole("button", {
      name: /merge into #projects/i,
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(mergeButton);
    await waitFor(() => expect(onRunMerge).toHaveBeenCalledWith("projects"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("rename: VaultAuthError shows the session-expired inline message", async () => {
    const onRun = vi.fn().mockRejectedValue(new VaultAuthError());
    const onClose = vi.fn();
    render(
      <TagRenameDialog
        mode="rename"
        sources={["work"]}
        tagOptions={["work"]}
        onClose={onClose}
        onRun={onRun}
        onRunMerge={vi.fn()}
        pending={false}
        offline={false}
      />,
    );
    fireEvent.change(screen.getByLabelText(/new tag name/i), {
      target: { value: "projects" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("merge: happy path toasts and closes", async () => {
    const onRun = vi.fn().mockResolvedValue({
      merged: { alpha: 3, beta: 2 },
      target: "projects",
    });
    const onClose = vi.fn();
    render(
      <TagRenameDialog
        mode="merge"
        sources={["alpha", "beta"]}
        tagOptions={["alpha", "beta", "projects"]}
        onClose={onClose}
        onRun={onRun}
        pending={false}
        offline={false}
      />,
    );
    fireEvent.change(screen.getByLabelText(/merge target tag/i), {
      target: { value: "projects" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(onRun).toHaveBeenCalledWith("projects"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("merge: arbitrary error shows the error message inline and keeps dialog open", async () => {
    const onRun = vi.fn().mockRejectedValue(new Error("boom"));
    const onClose = vi.fn();
    render(
      <TagRenameDialog
        mode="merge"
        sources={["a", "b"]}
        tagOptions={["a", "b"]}
        onClose={onClose}
        onRun={onRun}
        pending={false}
        offline={false}
      />,
    );
    fireEvent.change(screen.getByLabelText(/merge target tag/i), {
      target: { value: "c" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
