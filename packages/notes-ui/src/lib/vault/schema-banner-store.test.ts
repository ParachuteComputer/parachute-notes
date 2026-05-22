// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_BANNER_KEY_PREFIX, useSchemaBannerStore } from "./schema-banner-store";

describe("useSchemaBannerStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useSchemaBannerStore.setState({ dismissedByVault: {} });
  });
  afterEach(() => {
    localStorage.clear();
    useSchemaBannerStore.setState({ dismissedByVault: {} });
  });

  it("dismiss persists to localStorage + updates the store", () => {
    useSchemaBannerStore.getState().dismiss("v1");
    expect(useSchemaBannerStore.getState().dismissedByVault.v1).toBe(true);
    expect(localStorage.getItem(`${SCHEMA_BANNER_KEY_PREFIX}v1`)).toBe("1");
  });

  it("clearDismissed removes the flag from both store and localStorage", () => {
    useSchemaBannerStore.getState().dismiss("v1");
    expect(useSchemaBannerStore.getState().dismissedByVault.v1).toBe(true);

    useSchemaBannerStore.getState().clearDismissed("v1");
    expect(useSchemaBannerStore.getState().dismissedByVault.v1).toBeUndefined();
    expect(localStorage.getItem(`${SCHEMA_BANNER_KEY_PREFIX}v1`)).toBeNull();
  });

  it("tracks vaults independently", () => {
    useSchemaBannerStore.getState().dismiss("v1");
    useSchemaBannerStore.getState().dismiss("v2");
    expect(useSchemaBannerStore.getState().dismissedByVault.v1).toBe(true);
    expect(useSchemaBannerStore.getState().dismissedByVault.v2).toBe(true);

    useSchemaBannerStore.getState().clearDismissed("v1");
    expect(useSchemaBannerStore.getState().dismissedByVault.v1).toBeUndefined();
    expect(useSchemaBannerStore.getState().dismissedByVault.v2).toBe(true);
  });

  it("reloadFromStorage picks up entries written by another tab", () => {
    localStorage.setItem(`${SCHEMA_BANNER_KEY_PREFIX}v1`, "1");
    expect(useSchemaBannerStore.getState().dismissedByVault.v1).toBeUndefined();
    useSchemaBannerStore.getState().reloadFromStorage();
    expect(useSchemaBannerStore.getState().dismissedByVault.v1).toBe(true);
  });
});
