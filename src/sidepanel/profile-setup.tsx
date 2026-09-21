import React, { useMemo, useRef, useState } from "react";
import type {
  CollectorSettings,
  ExportBinding,
  ExportFieldMapping,
  ExportProfile,
} from "../core/types";
import type {
  AnkiCatalogService,
  AnkiCatalogSnapshot,
  AnkiModelInspectionResult,
} from "../anki/catalog";
import type {
  DeckAnalysis,
  DeckAnalysisService,
  RepresentativeAnkiCard,
} from "../anki/deck-analysis";
import {
  COLLECTOR_SEMANTIC_FIELDS,
  REQUIRED_MAPPED_SEMANTIC_FIELDS,
  validateFieldMapping,
} from "../anki/mapping";
import {
  COLLECTOR_MANAGED_MODEL_NAME,
  assignLanguageRoute,
  profileLanguage,
} from "../settings";
import {
  COMMON_PROFILE_LANGUAGES,
  assessUsedMappedProfileEdit,
  buildMappedPayloadPreview,
  isGuidedLanguageCode,
  languageLabel,
  profileLanguageFromSavedState,
  validateMappedProfileAgainstLive,
} from "../anki/profile-setup";

type CatalogKind = "idle" | "loading" | "live" | "stale" | "unavailable";
type AnalysisState =
  | { kind: "idle" }
  | { kind: "loading"; deckName: string }
  | { kind: "live"; analysis: DeckAnalysis }
  | { kind: "error"; deckName: string; error: string };
type ModelState =
  | { kind: "idle" }
  | { kind: "loading"; modelName: string }
  | AnkiModelInspectionResult;

interface Draft {
  profileId?: string;
  name: string;
  language: string;
  customLanguage: boolean;
  deckName: string;
  deckId: string;
  modelName: string;
  modelId: string;
  fieldMapping: ExportFieldMapping;
}

interface Props {
  settings: CollectorSettings;
  bindings: readonly ExportBinding[];
  catalogKind: CatalogKind;
  catalogSnapshot: AnkiCatalogSnapshot | null;
  catalogError?: string;
  catalogService: AnkiCatalogService;
  deckAnalysisService: DeckAnalysisService;
  persistSettings: (
    update: (current: CollectorSettings) => CollectorSettings,
  ) => Promise<CollectorSettings>;
  renderRepresentativePreview: (
    card: RepresentativeAnkiCard,
    side: "question" | "answer",
  ) => string;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

function emptyDraft(): Draft {
  return {
    name: "",
    language: "",
    customLanguage: false,
    deckName: "",
    deckId: "",
    modelName: "",
    modelId: "",
    fieldMapping: {},
  };
}

export function GuidedProfileSetup({
  settings,
  bindings,
  catalogKind,
  catalogSnapshot,
  catalogError,
  catalogService,
  deckAnalysisService,
  persistSettings,
  renderRepresentativePreview,
  onNotice,
  onError,
}: Props): React.ReactElement {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [analysisState, setAnalysisState] = useState<AnalysisState>({ kind: "idle" });
  const [modelState, setModelState] = useState<ModelState>({ kind: "idle" });
  const [representativeIndex, setRepresentativeIndex] = useState(0);
  const [remapAcknowledged, setRemapAcknowledged] = useState(false);
  const [profileStatus, setProfileStatus] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const requestId = useRef(0);
  const saveInFlight = useRef(false);

  const originalProfile = draft?.profileId
    ? settings.exportProfiles.find((profile) => profile.id === draft.profileId) ?? null
    : null;

  const selectedModelSample = useMemo(() => {
    if (!draft || analysisState.kind !== "live" || !draft.modelName) return null;
    return analysisState.analysis.models.find((model) => model.modelName === draft.modelName) ?? null;
  }, [analysisState, draft]);

  const representative = selectedModelSample?.representatives[
    Math.min(representativeIndex, Math.max(0, selectedModelSample.representatives.length - 1))
  ] ?? null;

  const liveModelDetail =
    modelState.kind === "live" && draft && modelState.detail.name === draft.modelName
      ? modelState.detail
      : null;

  const mappingValidation = liveModelDetail && draft
    ? validateFieldMapping(draft.fieldMapping, liveModelDetail.fields)
    : { valid: false, errors: ["Choose and inspect a live note type before mapping fields."], normalized: {} };

  const previewRows = liveModelDetail && draft
    ? buildMappedPayloadPreview(draft.fieldMapping, liveModelDetail.fields)
    : [];

  const nextProfile: ExportProfile | null = draft
    ? {
        id: draft.profileId ?? "pending",
        name: draft.name.trim() || ((draft.language ? languageLabel(draft.language) : "Language") + " — " + draft.deckName),
        language: draft.language.trim().toLowerCase(),
        deckName: draft.deckName,
        deckId: draft.deckId,
        modelName: draft.modelName,
        modelId: draft.modelId,
        mode: "mapped-user-model",
        fieldMapping: mappingValidation.normalized,
        identityStrategy: "collector-tag",
      }
    : null;

  const liveCompatibilityValidation =
    nextProfile && liveModelDetail && catalogSnapshot && catalogKind === "live"
      ? validateMappedProfileAgainstLive(nextProfile, catalogSnapshot, liveModelDetail)
      : null;

  const displayedMappingErrors =
    liveCompatibilityValidation?.errors ?? mappingValidation.errors;

  const editSafety = originalProfile && nextProfile
    ? assessUsedMappedProfileEdit(originalProfile, nextProfile, bindings)
    : null;

  function resetEvidence(): void {
    requestId.current += 1;
    setAnalysisState({ kind: "idle" });
    setModelState({ kind: "idle" });
    setRepresentativeIndex(0);
    setRemapAcknowledged(false);
  }

  function beginNew(): void {
    resetEvidence();
    setDraft(emptyDraft());
  }

  function beginEdit(profile: ExportProfile): void {
    if (profile.mode !== "mapped-user-model") {
      onError("Collector-managed destinations stay in the existing managed routing controls.");
      return;
    }
    const language = profileLanguageFromSavedState(profile, settings.languageRoutes) ?? "";
    const common = COMMON_PROFILE_LANGUAGES.some((entry) => entry.code === language);
    resetEvidence();
    setDraft({
      profileId: profile.id,
      name: profile.name,
      language,
      customLanguage: Boolean(language) && !common,
      deckName: profile.deckName,
      deckId: profile.deckId ?? "",
      modelName: profile.modelName,
      modelId: profile.modelId ?? "",
      fieldMapping: { ...(profile.fieldMapping ?? {}) },
    });

    if (catalogKind !== "live" || !catalogSnapshot) return;
    const deck = catalogSnapshot.decks.find((candidate) => candidate.name === profile.deckName);
    const model = catalogSnapshot.models.find((candidate) => candidate.name === profile.modelName);
    if (!deck || String(deck.id) !== profile.deckId || !model || String(model.id) !== profile.modelId) {
      setProfileStatus((current) => ({
        ...current,
        [profile.id]: "Saved live identity no longer matches Anki. Revalidate before editing this profile.",
      }));
      return;
    }

    const id = ++requestId.current;
    setAnalysisState({ kind: "loading", deckName: profile.deckName });
    setModelState({ kind: "loading", modelName: profile.modelName });
    void Promise.all([
      deckAnalysisService.analyze(profile.deckName),
      catalogService.inspectModel(profile.modelName),
    ]).then(
      ([analysis, inspected]) => {
        if (requestId.current !== id) return;
        setAnalysisState({ kind: "live", analysis });
        setModelState(inspected);
      },
      (error: unknown) => {
        if (requestId.current !== id) return;
        setAnalysisState({
          kind: "error",
          deckName: profile.deckName,
          error: error instanceof Error ? error.message : "Could not reopen live profile evidence.",
        });
        setModelState({ kind: "idle" });
      },
    );
  }

  async function chooseDeck(deckName: string): Promise<void> {
    if (!draft || catalogKind !== "live" || !catalogSnapshot) {
      onError("Refresh from live Anki before choosing a destination deck.");
      return;
    }
    const deck = catalogSnapshot.decks.find((candidate) => candidate.name === deckName);
    if (!deck) {
      onError("Choose a deck from the current live Anki catalog.");
      return;
    }

    const id = ++requestId.current;
    setDraft((current) => current
      ? {
          ...current,
          deckName,
          deckId: String(deck.id),
          modelName: "",
          modelId: "",
          fieldMapping: {},
        }
      : current
    );
    setModelState({ kind: "idle" });
    setRepresentativeIndex(0);
    setAnalysisState({ kind: "loading", deckName });

    try {
      const analysis = await deckAnalysisService.analyze(deckName);
      if (requestId.current !== id) return;
      setAnalysisState({ kind: "live", analysis });
    } catch (error) {
      if (requestId.current !== id) return;
      setAnalysisState({
        kind: "error",
        deckName,
        error: error instanceof Error ? error.message : "Could not analyze this deck.",
      });
    }
  }

  async function chooseModel(modelName: string): Promise<void> {
    if (!draft || catalogKind !== "live" || !catalogSnapshot) {
      onError("Refresh from live Anki before choosing a note type.");
      return;
    }
    const model = catalogSnapshot.models.find((candidate) => candidate.name === modelName);
    if (!model) {
      onError("The selected note type is not present in the current live Anki catalog.");
      return;
    }

    const keepMapping =
      originalProfile
      && originalProfile.modelName === modelName
      && String(originalProfile.modelId ?? "") === String(model.id);

    setDraft((current) => current
      ? {
          ...current,
          modelName,
          modelId: String(model.id),
          fieldMapping: keepMapping ? { ...(originalProfile?.fieldMapping ?? {}) } : {},
        }
      : current
    );
    const id = ++requestId.current;
    setRepresentativeIndex(0);
    setRemapAcknowledged(false);
    setModelState({ kind: "loading", modelName });
    const result = await catalogService.inspectModel(modelName);
    if (requestId.current !== id) return;
    setModelState(result);
  }

  async function revalidate(profile: ExportProfile): Promise<void> {
    if (catalogKind !== "live") {
      setProfileStatus((current) => ({
        ...current,
        [profile.id]: "Live revalidation requires Anki Desktop + AnkiConnect.",
      }));
      return;
    }
    if (profile.mode !== "mapped-user-model") {
      setProfileStatus((current) => ({
        ...current,
        [profile.id]: "Collector-managed profiles use their existing managed-model checks.",
      }));
      return;
    }

    const refreshed = await catalogService.refresh();
    if (refreshed.kind !== "live") {
      setProfileStatus((current) => ({
        ...current,
        [profile.id]: "Could not refresh live Anki metadata: " + refreshed.error,
      }));
      return;
    }
    const liveSnapshot = refreshed.snapshot;

    const liveDeck = liveSnapshot.decks.find((deck) => deck.name === profile.deckName);
    if (!liveDeck) {
      setProfileStatus((current) => ({ ...current, [profile.id]: "Saved deck is missing from live Anki." }));
      return;
    }
    if (String(liveDeck.id) !== profile.deckId) {
      setProfileStatus((current) => ({
        ...current,
        [profile.id]: "Same-name deck replacement rejected: the live deck ID no longer matches the saved ID.",
      }));
      return;
    }

    const liveModel = liveSnapshot.models.find((model) => model.name === profile.modelName);
    if (!liveModel) {
      setProfileStatus((current) => ({ ...current, [profile.id]: "Saved note type is missing from live Anki." }));
      return;
    }
    if (String(liveModel.id) !== profile.modelId) {
      setProfileStatus((current) => ({
        ...current,
        [profile.id]: "Same-name note-type replacement rejected: the live model ID no longer matches the saved ID.",
      }));
      return;
    }

    const inspected = await catalogService.inspectModel(profile.modelName);
    if (inspected.kind !== "live") {
      setProfileStatus((current) => ({
        ...current,
        [profile.id]: "Could not complete live note-type validation" + (inspected.kind === "stale" ? ": " + inspected.error : "."),
      }));
      return;
    }

    const validation = validateMappedProfileAgainstLive(profile, liveSnapshot, inspected.detail);
    if (!validation.valid) {
      setProfileStatus((current) => ({ ...current, [profile.id]: validation.errors.join(" ") }));
      return;
    }

    const lastValidatedAt = new Date().toISOString();
    await persistSettings((current) => ({
      ...current,
      exportProfiles: current.exportProfiles.map((candidate) =>
        candidate.id === profile.id ? { ...candidate, lastValidatedAt } : candidate
      ),
    }));
    setProfileStatus((current) => ({ ...current, [profile.id]: "Live validation passed." }));
  }

  async function saveProfile(): Promise<void> {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);

    try {
    if (!draft || !nextProfile || !liveModelDetail || catalogKind !== "live") {
      onError("Complete the live language, deck, note-type, and mapping steps before saving.");
      return;
    }
    if (!draft.language.trim()) {
      onError("Choose the profile language.");
      return;
    }
    if (!isGuidedLanguageCode(draft.language)) {
      onError("Use a language tag such as he, sr, es, or es-UY.");
      return;
    }
    if (!mappingValidation.valid) {
      onError(mappingValidation.errors.join(" "));
      return;
    }

    const refreshed = await catalogService.refresh();
    if (refreshed.kind !== "live") {
      onError("Live Anki revalidation failed before Save: " + refreshed.error);
      return;
    }
    const inspected = await catalogService.inspectModel(nextProfile.modelName);
    if (inspected.kind !== "live") {
      onError(
        "Live note-type revalidation failed before Save"
        + (inspected.kind === "stale" ? ": " + inspected.error : "."),
      );
      return;
    }

    const validation = validateMappedProfileAgainstLive(
      nextProfile,
      refreshed.snapshot,
      inspected.detail,
    );
    if (!validation.valid) {
      onError(validation.errors.join(" "));
      return;
    }

    if (editSafety?.durableBindingCount && editSafety.identityChanged) {
      onError(
        "This profile already owns exported/reserved notes. Deck or note-type identity cannot be changed in place. Create a new profile for future cards instead.",
      );
      return;
    }
    if (editSafety?.durableBindingCount && editSafety.fieldMappingChanged && !remapAcknowledged) {
      onError(
        "This profile already has exported notes. Confirm the remap consequence before changing which fields future updates write.",
      );
      return;
    }

    const profileId = draft.profileId ?? ("guided-" + crypto.randomUUID());
    const lastValidatedAt = new Date().toISOString();
    const savedProfile: ExportProfile = {
      ...nextProfile,
      id: profileId,
      lastValidatedAt,
    };
    const previousLanguage = originalProfile
      ? profileLanguageFromSavedState(originalProfile, settings.languageRoutes)
      : undefined;

    await persistSettings((current) => {
      const exportProfiles = [
        ...current.exportProfiles.filter((profile) => profile.id !== profileId),
        savedProfile,
      ];
      let next: CollectorSettings = {
        ...current,
        exportProfiles,
        captureProfileId: profileId,
      };
      next = assignLanguageRoute(next, savedProfile.language!, profileId, previousLanguage);
      return next;
    });

    onNotice(
      (savedProfile.language ? languageLabel(savedProfile.language) + " profile saved. " : "Profile saved. ")
      + "New captures use this profile language and route without the legacy global language field.",
    );
    setProfileStatus((current) => ({ ...current, [profileId]: "Live validation passed." }));
    setDraft(null);
    resetEvidence();
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  async function useForCapture(profile: ExportProfile): Promise<void> {
    const language = profileLanguage(settings, profile.id);
    if (!language) {
      onError("This legacy profile has no unambiguous language. Edit it through guided setup first.");
      return;
    }
    await persistSettings((current) =>
      assignLanguageRoute(
        { ...current, captureProfileId: profile.id },
        language,
        profile.id,
      )
    );
    onNotice(languageLabel(language) + " is now the active capture profile and language route.");
  }

  return (
    <section className="guided-profiles" aria-labelledby="guided-profiles-title">
      <div className="anki-catalog-head">
        <div>
          <strong id="guided-profiles-title">Guided export profiles</strong>
          <div className="setting-help">
            Language → live deck → explicit note type → representative card → field mapping → payload preview.
          </div>
        </div>
        <button type="button" onClick={beginNew} disabled={saving || catalogKind !== "live"}>
          New profile
        </button>
      </div>

      {catalogKind !== "live" && (
        <div className="guided-offline" role="status">
          Saved profiles stay available. Live discovery, revalidation, representative preview, and new profile setup require Anki Desktop + AnkiConnect.
          {catalogError ? " " + catalogError : ""}
        </div>
      )}

      <div className="saved-profile-list">
        {settings.exportProfiles.map((profile) => {
          const language = profileLanguageFromSavedState(profile, settings.languageRoutes);
          const durableCount = bindings.filter(
            (binding) => binding.profileId === profile.id && (binding.state === "reserved" || binding.state === "exported"),
          ).length;
          return (
            <article className="saved-profile" key={profile.id} data-profile-id={profile.id}>
              <div className="saved-profile-head">
                <div>
                  <strong>{profile.name}</strong>
                  <div className="setting-help">
                    {language ? languageLabel(language) + " (" + language + ") · " : "Legacy language not stored · "}
                    {profile.deckName} · {profile.modelName}
                  </div>
                </div>
                {settings.captureProfileId === profile.id && <span className="pill">capture</span>}
              </div>
              <div className="saved-profile-meta">
                <span>{profile.mode === "mapped-user-model" ? "User-owned note type" : "Collector-managed"}</span>
                {profile.deckId && <span>deck ID {profile.deckId}</span>}
                {profile.modelId && <span>model ID {profile.modelId}</span>}
                {profile.lastValidatedAt && <span>validated {new Date(profile.lastValidatedAt).toLocaleString()}</span>}
                {durableCount > 0 && <span>{durableCount} pinned/exported binding{durableCount === 1 ? "" : "s"}</span>}
              </div>
              {profileStatus[profile.id] && (
                <div className="profile-validation-status" role="status">{profileStatus[profile.id]}</div>
              )}
              <div className="language-deck-actions">
                <button className="ghost" type="button" onClick={() => void useForCapture(profile)} disabled={saving || !language}>
                  Use for capture
                </button>
                {profile.mode === "mapped-user-model" && (
                  <>
                    <button
                      className="ghost"
                      type="button"
                      disabled={saving || catalogKind !== "live"}
                      onClick={() => beginEdit(profile)}
                    >
                      Edit
                    </button>
                    <button className="ghost" type="button" disabled={saving || catalogKind !== "live"} onClick={() => void revalidate(profile)}>
                      Revalidate
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {draft && (
        <form
          className="guided-profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveProfile();
          }}
        >
          <div className="guided-step">
            <strong>1. Language</strong>
            <label>
              Profile language
              <select
                aria-label="Profile language"
                value={draft.customLanguage ? "__other__" : draft.language}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "__other__") {
                    setDraft({ ...draft, language: "", customLanguage: true });
                  } else {
                    setDraft({ ...draft, language: value, customLanguage: false });
                  }
                }}
              >
                <option value="">Choose language…</option>
                {COMMON_PROFILE_LANGUAGES.map((entry) => (
                  <option key={entry.code} value={entry.code}>{entry.label} — {entry.code}</option>
                ))}
                <option value="__other__">Other language…</option>
              </select>
            </label>
            {draft.customLanguage && (
              <label>
                Other language code
                <input
                  aria-label="Other profile language code"
                  value={draft.language}
                  placeholder="e.g. nl"
                  onChange={(event) => setDraft({ ...draft, language: event.target.value.trim().toLowerCase() })}
                />
              </label>
            )}
            <label>
              Profile name
              <input
                aria-label="Export profile name"
                value={draft.name}
                placeholder="Optional; a descriptive name is generated if blank"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
          </div>

          <div className="guided-step">
            <strong>2. Destination deck</strong>
            <label>
              Live Anki deck
              <select
                aria-label="Live Anki deck"
                value={draft.deckName}
                onChange={(event) => void chooseDeck(event.target.value)}
                disabled={catalogKind !== "live"}
              >
                <option value="">Choose deck…</option>
                {catalogSnapshot?.decks.map((deck) => (
                  <option key={String(deck.id)} value={deck.name}>{deck.name}</option>
                ))}
              </select>
            </label>
            {draft.deckId && <div className="setting-help">Pinned live deck ID: {draft.deckId}</div>}
          </div>

          <div className="guided-step">
            <strong>3. Note types found in the selected deck</strong>
            {analysisState.kind === "idle" && <div className="setting-help">Choose a deck to inspect its bounded sample.</div>}
            {analysisState.kind === "loading" && <div role="status">Analyzing {analysisState.deckName}…</div>}
            {analysisState.kind === "error" && <div className="proposal-warning" role="alert">{analysisState.error}</div>}
            {analysisState.kind === "live" && (
              <>
                <div className="setting-help">
                  Sample evidence only: {analysisState.analysis.inspectedCardCount}/{analysisState.analysis.sampledCardCount} sampled cards inspected.
                  Collector never chooses the target note type from popularity.
                </div>
                <label>
                  Intended note type
                  <select
                    aria-label="Intended note type"
                    value={draft.modelName}
                    onChange={(event) => void chooseModel(event.target.value)}
                  >
                    <option value="">Choose explicitly…</option>
                    {analysisState.analysis.models
                      .filter((model) => model.modelName !== COLLECTOR_MANAGED_MODEL_NAME)
                      .map((model) => (
                        <option key={model.modelName} value={model.modelName}>
                          {model.modelName} — {model.sampledCount}/{analysisState.analysis.inspectedCardCount} sampled
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
          </div>

          {draft.modelName && (
            <div className="guided-step">
              <strong>4. Representative existing card</strong>
              {modelState.kind === "loading" && <div role="status">Inspecting {modelState.modelName}…</div>}
              {modelState.kind === "unavailable" && <div className="proposal-warning" role="alert">{modelState.error}</div>}
              {modelState.kind === "stale" && (
                <div className="proposal-warning" role="alert">Cached metadata cannot authorize Save: {modelState.error}</div>
              )}
              {representative ? (
                <article className="representative-card guided-representative">
                  <div className="representative-meta">
                    <span>{representative.modelName}</span>
                    <span>{selectedModelSample?.representatives.length ?? 0} representative sample(s)</span>
                  </div>
                  <div className="representative-side">
                    <strong>Front</strong>
                    <iframe
                      className="anki-preview-frame"
                      sandbox=""
                      referrerPolicy="no-referrer"
                      title={draft.modelName + " guided representative front"}
                      srcDoc={renderRepresentativePreview(representative, "question")}
                    />
                  </div>
                  <div className="representative-side">
                    <strong>Back</strong>
                    <iframe
                      className="anki-preview-frame"
                      sandbox=""
                      referrerPolicy="no-referrer"
                      title={draft.modelName + " guided representative back"}
                      srcDoc={renderRepresentativePreview(representative, "answer")}
                    />
                  </div>
                  {(selectedModelSample?.representatives.length ?? 0) > 1 && (
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => setRepresentativeIndex(
                        (representativeIndex + 1) % selectedModelSample!.representatives.length
                      )}
                    >
                      Another representative
                    </button>
                  )}
                </article>
              ) : (
                <div className="setting-help">No representative sample is available for this selected note type.</div>
              )}
            </div>
          )}

          {liveModelDetail && (
            <>
              <div className="guided-step">
                <strong>5. Field mapping</strong>
                <div className="setting-help">
                  Existing fields/templates/CSS are read-only. Prompt and Answer are required. Other Collector values are optional.
                </div>
                <div className="mapping-grid">
                  {COLLECTOR_SEMANTIC_FIELDS.map((semantic) => (
                    <label key={semantic}>
                      Collector {semantic}{REQUIRED_MAPPED_SEMANTIC_FIELDS.includes(semantic) ? " *" : ""}
                      <select
                        aria-label={"Map Collector " + semantic}
                        value={draft.fieldMapping[semantic] ?? ""}
                        onChange={(event) => setDraft({
                          ...draft,
                          fieldMapping: {
                            ...draft.fieldMapping,
                            [semantic]: event.target.value || undefined,
                          },
                        })}
                      >
                        <option value="">Leave unmapped</option>
                        {liveModelDetail.fields.map((field) => (
                          <option key={field} value={field}>{field}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                {displayedMappingErrors.length > 0 && (
                  <ul className="conflict-list" aria-label="Field mapping errors">
                    {displayedMappingErrors.map((message) => <li key={message}>{message}</li>)}
                  </ul>
                )}
              </div>

              <div className="guided-step">
                <strong>6. Outgoing payload preview</strong>
                <div className="setting-help">
                  This previews data placement only. Unmapped existing fields are omitted from Collector writes.
                </div>
                <div className="payload-preview" aria-label="Outgoing mapped payload preview">
                  {previewRows.map((row) => (
                    <div className="payload-preview-row" key={row.field}>
                      <strong>{row.field}</strong>
                      {row.untouched
                        ? <span className="untouched">Untouched / omitted</span>
                        : <span>{row.semantic}: {row.value}</span>}
                    </div>
                  ))}
                </div>
                <div className="setting-help">Identity strategy: reserved Collector tag. No user-owned field is added.</div>
              </div>
            </>
          )}

          {editSafety && editSafety.durableBindingCount > 0 && (
            <div className="guided-used-warning" role="status">
              <strong>This profile is already used by {editSafety.durableBindingCount} exported/reserved note{editSafety.durableBindingCount === 1 ? "" : "s"}.</strong>
              <span>Deck/note-type identity changes are blocked. A field remap changes which fields future updates write; it never silently remaps existing Anki note content.</span>
              {editSafety.fieldMappingChanged && !editSafety.identityChanged && (
                <label className="remap-confirm">
                  <input
                    type="checkbox"
                    checked={remapAcknowledged}
                    onChange={(event) => setRemapAcknowledged(event.target.checked)}
                  />
                  I understand this remap affects future updates to already-bound notes.
                </label>
              )}
            </div>
          )}

          <div className="toolbar">
            <button
              className="primary"
              type="submit"
              disabled={
                saving
                || catalogKind !== "live"
                || !draft.language
                || !isGuidedLanguageCode(draft.language)
                || !draft.deckId
                || !draft.modelId
                || !liveModelDetail
                || !liveCompatibilityValidation?.valid
                || Boolean(editSafety?.durableBindingCount && editSafety.identityChanged)
                || Boolean(editSafety?.durableBindingCount && editSafety.fieldMappingChanged && !remapAcknowledged)
              }
            >
              {saving ? "Saving…" : "Save profile + language route"}
            </button>
            <button
              className="ghost"
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft(null);
                resetEvidence();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
