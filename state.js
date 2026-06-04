// --- Config ---
export const config = {
    selectors: {
        appBody: 'body',
        promptList: '#completion_prompt_manager_list',
        promptListItem: 'li.completion_prompt_manager_prompt',
        promptLink: 'a.prompt-manager-inspect-action',
        promptNameSpan: 'span.completion_prompt_manager_prompt_name',
        promptAsterisk: '.fa-asterisk',
        listHeader: '.completion_prompt_manager_list_head',
    },
    classNames: {
        groupingRoot: 'pf-grouping-root',
        group: 'pf-prompt-group',
        groupContent: 'pf-prompt-group-content',
        isGroupHeader: 'pf-is-group-header',
        disabledByGroup: 'pf-controlled-by-disabled-group',
        dragging: 'pf-dragging',
        draggingGroup: 'pf-dragging-group',
    },
    defaultDividers: ['=', '-'],
};

// --- Get current preset name ---
export function getCurrentPresetName() {
    const select = document.querySelector('#settings_preset_openai');
    if (select) {
        const selected = select.querySelector(':checked');
        if (selected) return selected.textContent.trim();
    }
    return 'default';
}

// --- State ---
export let state = {
    openGroups: {},
    isEnabled: true,
    customDividers: [...config.defaultDividers],
    foldingMode: 'manual',
    debugMode: false,
    manualHeaders: new Set(),
    originalNames: new Map(),

    isProcessing: false,
    observers: new WeakMap(),
    groupHierarchy: {},
    groupHeaderStatus: {},
    isSelectingHeaders: false,
};

// Initialize Regex
export let dividerRegex = buildDividerRegex();

export function buildDividerRegex() {
    const patterns = state.customDividers.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`^(${patterns.join('|')})`, 'i');
}

// Debug log
export function log(...args) {
    if (state.debugMode) {
        console.log('[PF]', ...args);
    }
}

// --- savePreset fn cache ---
let _cachedSavePreset = null;

export function setCachedSavePreset(fn) {
    _cachedSavePreset = fn;
}

// --- Load state from preset extensions ---
export function loadFromPreset(pfData) {
    const rawHeaders = pfData?.manualHeaders ?? [];
    const uuids = rawHeaders.map(h => (typeof h === 'string' ? h : h?.uuid)).filter(Boolean);

    state.openGroups     = pfData?.openStates     ?? {};
    state.isEnabled      = pfData?.featureEnabled  ?? true;
    state.customDividers = pfData?.customDividers  ?? [...config.defaultDividers];
    state.foldingMode    = pfData?.foldingMode     ?? 'manual';
    state.debugMode      = pfData?.debugMode       ?? false;
    state.manualHeaders  = new Set(uuids);
    state.originalNames  = new Map();

    dividerRegex = buildDividerRegex();
    log('loadFromPreset:', pfData ? `mode=${state.foldingMode}, headers=${uuids.length}` : 'no data, defaults');
}

function normalizePfData(pfData) {
    if (!pfData) return null;
    const rawHeaders = pfData.manualHeaders ?? [];
    const uuids = rawHeaders.map(h => (typeof h === 'string' ? h : h?.uuid)).filter(Boolean);
    return {
        openStates:     pfData.openStates     ?? {},
        featureEnabled: pfData.featureEnabled  ?? true,
        foldingMode:    pfData.foldingMode     ?? 'manual',
        customDividers: pfData.customDividers  ?? [...config.defaultDividers],
        debugMode:      pfData.debugMode       ?? false,
        manualHeaders:  uuids,
    };
}

// --- Serialize state for preset save ---
export function getStateForSave() {
    return {
        openStates:     state.openGroups,
        featureEnabled: state.isEnabled,
        foldingMode:    state.foldingMode,
        customDividers: state.customDividers,
        debugMode:      state.debugMode,
        manualHeaders:  [...state.manualHeaders],
    };
}

// --- Save to preset JSON ---
export async function saveToPreset() {
    try {
        const [
            { oai_settings, openai_settings: oaiSettingsArr, openai_setting_names },
            { getRequestHeaders },
        ] = await Promise.all([
            import('../../../../scripts/openai.js'),
            import('../../../../script.js'),
        ]);

        const pfData = getStateForSave();

        oai_settings.extensions = oai_settings.extensions || {};
        oai_settings.extensions.prompt_folding = pfData;

        const name = oai_settings.preset_settings_openai || getCurrentPresetName();
        const idx = openai_setting_names[name];
        if (idx !== undefined) {
            oaiSettingsArr[idx].extensions = oaiSettingsArr[idx].extensions || {};
            oaiSettingsArr[idx].extensions.prompt_folding = pfData;
        }

        if (_cachedSavePreset) {
            await _cachedSavePreset(name, oai_settings, false);
        } else {
            if (idx === undefined) {
                console.error('[PF] saveToPreset: preset not found:', name);
                return;
            }
            const res = await fetch('/api/presets/save', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ apiId: 'openai', name, preset: oaiSettingsArr[idx] }),
            });
            if (!res.ok) {
                console.error('[PF] saveToPreset: server returned', res.status);
                return;
            }
        }
        log('Saved to preset:', name);
    } catch (err) {
        console.error('[PF] saveToPreset failed:', err);
    }
}

export function saveCustomSettings() {
    saveToPreset().catch(err => console.error('[PF] Save failed:', err));
}

// --- Read folding data from in-memory preset ---
export async function getCurrentPresetFoldingData() {
    try {
        const { oai_settings, openai_settings, openai_setting_names } = await import('../../../../scripts/openai.js');
        const name = oai_settings.preset_settings_openai || getCurrentPresetName();
        const idx = openai_setting_names[name];
        if (idx === undefined) return null;
        return openai_settings[idx]?.extensions?.prompt_folding ?? null;
    } catch (err) {
        console.error('[PF] getCurrentPresetFoldingData failed:', err);
        return null;
    }
}

export function getAllPresetNames() {
    return Array.from(
        document.querySelectorAll('#settings_preset_openai option'),
    ).map(opt => opt.textContent.trim()).filter(Boolean);
}

export async function exportConfigFromPreset(presetName) {
    const currentName = getCurrentPresetName();
    if (presetName === currentName) {
        return getStateForSave();
    }
    try {
        const { openai_settings, openai_setting_names } = await import('../../../../scripts/openai.js');
        const idx = openai_setting_names[presetName];
        const presetData = openai_settings?.[idx];
        const pfData = presetData?.extensions?.prompt_folding;
        return pfData ? normalizePfData(pfData) : null;
    } catch (err) {
        console.error('[PF] exportConfigFromPreset failed:', err);
        return null;
    }
}

export async function importConfigToCurrentPreset(configData, currentPromptItems) {
    log('Importing config from another preset to', getCurrentPresetName());
    const normalized = normalizePfData(configData);
    loadFromPreset(normalized);

    const currentUuids = new Set(
        currentPromptItems.map(item => item.dataset.pmIdentifier).filter(Boolean),
    );
    const matched = [];
    const failed = [];
    state.manualHeaders.forEach(uuid => {
        if (currentUuids.has(uuid)) matched.push(uuid);
        else failed.push(uuid);
    });
    state.manualHeaders = new Set(matched);
    await saveToPreset();
    log('Import completed: matched', matched.length, 'failed', failed.length);
    return { byUuid: matched.length, failed };
}
