import { create } from "zustand";

// Open-state for the Cmd/Ctrl+K spotlight. Split out from `QuickSwitchMount`
// so the mobile bottom-tab Search button (and any other surface) can trigger
// the switcher without passing callbacks through the tree.
interface QuickSwitchOpenState {
  open: boolean;
  setOpen(next: boolean): void;
  toggle(): void;
}

export const useQuickSwitchOpen = create<QuickSwitchOpenState>((set) => ({
  open: false,
  setOpen(next) {
    set({ open: next });
  },
  toggle() {
    set((s) => ({ open: !s.open }));
  },
}));
