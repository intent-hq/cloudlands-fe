import { describe, expect, it } from "vitest";
import {
  cycleFontStyle,
  cycleNoteFontStyle,
  deleteActivityLogPreset,
  dismissPromoBanner,
  hydrateActivityLogPresets,
  hydratePromoBannerInteractions,
  initialState,
  loadBetaUpdatesSettings,
  recordPromoBannerInteraction,
  resetNotificationSettings,
  saveActivityLogPreset,
  setAgentFontStyle,
  setCodeFontFamily,
  setGroupByRepo,
  setHasCompletedProviderSetup,
  setNotificationEnabled,
  setNoteFontStyle,
  setShowArchived,
  setBetaUpdatesEnabled,
  setSpellcheckEnabled,
  setSoundEnabled,
  setSoundOnlyWhenUnfocused,
  setSystemFonts,
  setVolume,
  setZoomFactor,
  type AgentFontStyle,
  toggleGroupByRepo,
  toggleHasCompletedProviderSetup,
  toggleShowArchived,
  toggleBetaUpdates,
  toggleSpellcheck,
  type UserPreferencesState,
  userPreferencesReducer,
} from "./user-preferences-slice";
import {
  selectAgentFontStyle,
  selectAgentFontStyleLabel,
  selectActivityLogPresets,
  selectCodeFontFamily,
  selectCodeFontFamilyCSS,
  selectCodeFontFamilyLabel,
  selectCodeFontOptions,
  selectGroupByRepo,
  selectHasCompletedProviderSetup,
  selectIsAgentMonospace,
  selectIsNoteMonospace,
  selectNoteFontStyle,
  selectNoteFontStyleLabel,
  selectNotificationEnabled,
  selectNotificationVolume,
  selectPromoBannerInteractionRecord,
  selectPromoBannerInteractions,
  selectShowArchived,
  selectSoundEnabled,
  selectSoundOnlyWhenUnfocused,
} from "./user-preferences-selectors";

describe("userPreferencesReducer", () => {
  it("should return initial state", () => {
    const state = userPreferencesReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("beta updates actions", () => {
    it("should set beta updates enabled to true", () => {
      const state = userPreferencesReducer(initialState, setBetaUpdatesEnabled(true));
      expect(state.betaUpdatesEnabled).toBe(true);
    });

    it("should set beta updates enabled to false", () => {
      const state = userPreferencesReducer(
        { ...initialState, betaUpdatesEnabled: true },
        setBetaUpdatesEnabled(false)
      );
      expect(state.betaUpdatesEnabled).toBe(false);
    });

    it("should load beta updates settings to true", () => {
      const state = userPreferencesReducer(initialState, loadBetaUpdatesSettings(true));
      expect(state.betaUpdatesEnabled).toBe(true);
    });

    it("should load beta updates settings to false", () => {
      const state = userPreferencesReducer(
        { ...initialState, betaUpdatesEnabled: true },
        loadBetaUpdatesSettings(false)
      );
      expect(state.betaUpdatesEnabled).toBe(false);
    });

    it("should toggle beta updates from false to true", () => {
      const state = userPreferencesReducer(initialState, toggleBetaUpdates());
      expect(state.betaUpdatesEnabled).toBe(true);
    });

    it("should toggle beta updates from true to false", () => {
      const state = userPreferencesReducer(
        { ...initialState, betaUpdatesEnabled: true },
        toggleBetaUpdates()
      );
      expect(state.betaUpdatesEnabled).toBe(false);
    });
  });

  describe("spellcheck actions", () => {
    it("should set spellcheck enabled to true", () => {
      const state = userPreferencesReducer(initialState, setSpellcheckEnabled(true));
      expect(state.spellcheckEnabled).toBe(true);
    });

    it("should set spellcheck enabled to false", () => {
      const state = userPreferencesReducer(
        { ...initialState, spellcheckEnabled: true },
        setSpellcheckEnabled(false)
      );
      expect(state.spellcheckEnabled).toBe(false);
    });

    it("should toggle spellcheck from false to true", () => {
      const state = userPreferencesReducer(initialState, toggleSpellcheck());
      expect(state.spellcheckEnabled).toBe(true);
    });

    it("should toggle spellcheck from true to false", () => {
      const state = userPreferencesReducer(
        { ...initialState, spellcheckEnabled: true },
        toggleSpellcheck()
      );
      expect(state.spellcheckEnabled).toBe(false);
    });
  });

  describe("setZoomFactor", () => {
    const state: UserPreferencesState = { ...initialState, zoomFactor: 1.0 };

    it("should set zoom factor", () => {
      expect(userPreferencesReducer(state, setZoomFactor(1.5)).zoomFactor).toBe(1.5);
    });

    it("should return same state if zoom factor unchanged", () => {
      expect(userPreferencesReducer(state, setZoomFactor(1.0))).toBe(state);
    });

    it("should reject invalid zoom factors", () => {
      expect(userPreferencesReducer(state, setZoomFactor(0))).toBe(state);
      expect(userPreferencesReducer(state, setZoomFactor(-1))).toBe(state);
      expect(userPreferencesReducer(state, setZoomFactor(NaN))).toBe(state);
      expect(userPreferencesReducer(state, setZoomFactor(Infinity))).toBe(state);
    });

    it("should accept valid zoom factors", () => {
      expect(userPreferencesReducer(state, setZoomFactor(0.5)).zoomFactor).toBe(0.5);
      expect(userPreferencesReducer(state, setZoomFactor(3.0)).zoomFactor).toBe(3.0);
    });
  });

  describe("home page preference actions", () => {
    it("should set showArchived", () => {
      const state = userPreferencesReducer(initialState, setShowArchived(true));
      expect(state.showArchived).toBe(true);
    });

    it("should toggle showArchived", () => {
      const state = userPreferencesReducer(initialState, toggleShowArchived());
      expect(state.showArchived).toBe(true);
    });

    it("should set groupByRepo", () => {
      const state = userPreferencesReducer(initialState, setGroupByRepo(false));
      expect(state.groupByRepo).toBe(false);
    });

    it("should toggle groupByRepo", () => {
      const state = userPreferencesReducer(initialState, toggleGroupByRepo());
      expect(state.groupByRepo).toBe(false);
    });

    it("should set hasCompletedProviderSetup", () => {
      const state = userPreferencesReducer(initialState, setHasCompletedProviderSetup(true));
      expect(state.hasCompletedProviderSetup).toBe(true);
    });

    it("should toggle hasCompletedProviderSetup", () => {
      const state = userPreferencesReducer(initialState, toggleHasCompletedProviderSetup());
      expect(state.hasCompletedProviderSetup).toBe(true);
    });
  });

  describe("font settings actions", () => {
    it("keeps action type prefixes under fontSettings", () => {
      expect(setAgentFontStyle.type).toBe("fontSettings/setAgentFontStyle");
      expect(cycleFontStyle.type).toBe("fontSettings/cycleFontStyle");
      expect(setNoteFontStyle.type).toBe("fontSettings/setNoteFontStyle");
      expect(cycleNoteFontStyle.type).toBe("fontSettings/cycleNoteFontStyle");
      expect(setCodeFontFamily.type).toBe("fontSettings/setCodeFontFamily");
      expect(setSystemFonts.type).toBe("fontSettings/setSystemFonts");
    });

    it("updates and cycles agent font style", () => {
      expect(userPreferencesReducer(initialState, setAgentFontStyle("monospace")).agentFontStyle).toBe(
        "monospace"
      );
      expect(userPreferencesReducer(initialState, cycleFontStyle()).agentFontStyle).toBe("monospace");
      expect(
        userPreferencesReducer(
          { ...initialState, agentFontStyle: "monospace" },
          cycleFontStyle()
        ).agentFontStyle
      ).toBe("sans");
    });

    it("updates and cycles note font style", () => {
      expect(userPreferencesReducer(initialState, setNoteFontStyle("monospace")).noteFontStyle).toBe(
        "monospace"
      );
      expect(userPreferencesReducer(initialState, cycleNoteFontStyle()).noteFontStyle).toBe(
        "monospace"
      );
      expect(
        userPreferencesReducer(
          { ...initialState, noteFontStyle: "monospace" },
          cycleNoteFontStyle()
        ).noteFontStyle
      ).toBe("sans");
    });

    it("updates code font family and system fonts", () => {
      const withCodeFont = userPreferencesReducer(initialState, setCodeFontFamily("Fira Code"));
      const withSystemFonts = userPreferencesReducer(
        withCodeFont,
        setSystemFonts(["JetBrains Mono", "Cascadia Code"])
      );

      expect(withSystemFonts.codeFontFamily).toBe("Fira Code");
      expect(withSystemFonts.systemFonts).toEqual(["JetBrains Mono", "Cascadia Code"]);
    });
  });

  describe("notification settings actions", () => {
    it("keeps action type prefixes under notificationSettings", () => {
      expect(setNotificationEnabled.type).toBe("notificationSettings/setNotificationEnabled");
      expect(setSoundEnabled.type).toBe("notificationSettings/setSoundEnabled");
      expect(setSoundOnlyWhenUnfocused.type).toBe(
        "notificationSettings/setSoundOnlyWhenUnfocused"
      );
      expect(setVolume.type).toBe("notificationSettings/setVolume");
      expect(resetNotificationSettings.type).toBe(
        "notificationSettings/resetNotificationSettings"
      );
    });

    it("updates notification booleans", () => {
      let state = userPreferencesReducer(initialState, setNotificationEnabled(false));
      expect(state.enabled).toBe(false);

      state = userPreferencesReducer(state, setSoundEnabled(false));
      expect(state.soundEnabled).toBe(false);

      state = userPreferencesReducer(state, setSoundOnlyWhenUnfocused(false));
      expect(state.soundOnlyWhenUnfocused).toBe(false);
    });

    it("clamps notification volume", () => {
      expect(userPreferencesReducer(initialState, setVolume(-0.5)).volume).toBe(0);
      expect(userPreferencesReducer(initialState, setVolume(1.5)).volume).toBe(1);
      expect(userPreferencesReducer(initialState, setVolume(0.8)).volume).toBe(0.8);
    });

    it("resets notification settings without affecting other preferences", () => {
      const modified = userPreferencesReducer(
        {
          ...initialState,
          enabled: false,
          soundEnabled: false,
          soundOnlyWhenUnfocused: false,
          volume: 0.2,
          noteFontStyle: "monospace",
        },
        resetNotificationSettings()
      );

      expect(modified.enabled).toBe(true);
      expect(modified.soundEnabled).toBe(true);
      expect(modified.soundOnlyWhenUnfocused).toBe(true);
      expect(modified.volume).toBe(0.5);
      expect(modified.noteFontStyle).toBe("monospace");
    });
  });

  describe("small renderer preference persistence actions", () => {
    const preset = {
      name: "Errors",
      filters: {
        showFileChanges: false,
        showAgentActivity: true,
        showSystemEvents: false,
        showErrors: true,
        searchQuery: "error",
        dateRange: "today",
        actorFilter: "agent",
      },
    };

    it("hydrates, saves, and deletes activity log presets", () => {
      const hydrated = userPreferencesReducer(initialState, hydrateActivityLogPresets([preset]));
      const saved = userPreferencesReducer(hydrated, saveActivityLogPreset({ ...preset, name: "All" }));
      const deleted = userPreferencesReducer(saved, deleteActivityLogPreset(0));

      expect(hydrated.activityLogPresets).toEqual([preset]);
      expect(saved.activityLogPresets.map((item) => item.name)).toEqual(["Errors", "All"]);
      expect(deleted.activityLogPresets.map((item) => item.name)).toEqual(["All"]);
    });

    it("hydrates, records, and dismisses promotional banner interactions", () => {
      const hydrated = userPreferencesReducer(
        initialState,
        hydratePromoBannerInteractions({ bannerA: { dismissed: false, interactions: [] } })
      );
      const recorded = userPreferencesReducer(
        hydrated,
        recordPromoBannerInteraction("bannerA", {
          type: "button_click",
          buttonText: "Install",
          actionType: "setDefaultAgent",
          result: "success",
          timestamp: "2026-04-29T00:00:00.000Z",
        })
      );
      const dismissed = userPreferencesReducer(
        recorded,
        dismissPromoBanner("bannerA", "2026-04-29T00:01:00.000Z", true)
      );

      expect(recorded.promoBannerInteractions.bannerA.interactions).toHaveLength(1);
      expect(dismissed.promoBannerInteractions.bannerA).toMatchObject({
        dismissed: true,
        dismissedAt: "2026-04-29T00:01:00.000Z",
        completedAllSteps: true,
      });
      const interactions = dismissed.promoBannerInteractions.bannerA.interactions;
      expect(interactions[interactions.length - 1]?.type).toBe("dismiss");
    });
  });

  describe("selectors", () => {
    const state = {
      userPreferences: {
        ...initialState,
        agentFontStyle: "monospace" as AgentFontStyle,
        noteFontStyle: "monospace",
        codeFontFamily: "JetBrains Mono",
        systemFonts: ["JetBrains Mono"],
        enabled: false,
        soundEnabled: false,
        soundOnlyWhenUnfocused: false,
        volume: 0.25,
        showArchived: true,
        groupByRepo: false,
        hasCompletedProviderSetup: true,
      },
    } as any;

    it("selects home page preference values", () => {
      expect(selectShowArchived.select(state)).toBe(true);
      expect(selectGroupByRepo.select(state)).toBe(false);
      expect(selectHasCompletedProviderSetup.select(state)).toBe(true);
    });

    it("selects font settings from userPreferences", () => {
      expect(selectAgentFontStyle.select(state)).toBe("monospace");
      expect(selectAgentFontStyleLabel.select(state)).toBe("Monospace");
      expect(selectIsAgentMonospace.select(state)).toBe(true);
      expect(selectNoteFontStyle.select(state)).toBe("monospace");
      expect(selectNoteFontStyleLabel.select(state)).toBe("Monospace");
      expect(selectIsNoteMonospace.select(state)).toBe(true);
      expect(selectCodeFontFamily.select(state)).toBe("JetBrains Mono");
      expect(selectCodeFontFamilyCSS.select(state)).toBe("'JetBrains Mono', monospace");
      expect(selectCodeFontFamilyLabel.select(state)).toBe("JetBrains Mono");
      expect(selectCodeFontOptions.select(state)).toEqual([
        {
          value: "system-default",
          label: "System Default",
          fontFamily:
            "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace",
        },
        {
          value: "JetBrains Mono",
          label: "JetBrains Mono",
          fontFamily: "'JetBrains Mono', monospace",
        },
      ]);
    });

    it("selects notification settings from userPreferences", () => {
      expect(selectNotificationEnabled.select(state)).toBe(false);
      expect(selectSoundEnabled.select(state)).toBe(false);
      expect(selectSoundOnlyWhenUnfocused.select(state)).toBe(false);
      expect(selectNotificationVolume.select(state)).toBe(0.25);
    });

    it("selects migrated small renderer preferences", () => {
      const preferenceState = {
        userPreferences: {
          ...initialState,
          activityLogPresets: [{ name: "Errors", filters: {} }],
          promoBannerInteractions: { bannerA: { dismissed: true, interactions: [] } },
        },
      } as any;

      expect(selectActivityLogPresets.select(preferenceState)).toEqual([
        { name: "Errors", filters: {} },
      ]);
      expect(selectPromoBannerInteractions.select(preferenceState)).toEqual({
        bannerA: { dismissed: true, interactions: [] },
      });
      expect(selectPromoBannerInteractionRecord.select(preferenceState, "bannerA")).toEqual({
        dismissed: true,
        interactions: [],
      });
    });

  });
});
