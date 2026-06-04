export const EXTENSION_KEY = 'riyuexi_prompt_folders';
export const LEGACY_EXTENSION_KEY = 'prompt_folding';

export const config = {
    selectors: {
        promptManager: '#completion_prompt_manager',
        promptHeader: '.completion_prompt_manager_header',
        promptList: '#completion_prompt_manager_list',
        promptListItem: 'li.completion_prompt_manager_prompt',
        promptLink: 'a.prompt-manager-inspect-action',
        promptNameSpan: 'span.completion_prompt_manager_prompt_name',
    },
    classNames: {
        folder: 'ryx-prompt-folder',
        folderContent: 'ryx-prompt-folder-content',
        folderHeader: 'ryx-folder-header',
        controlledByFolder: 'ryx-controlled-by-disabled-folder',
    },
};

export const state = {
    enabled: true,
    folderIds: new Set(),
    openStates: {},
    debug: false,

    isProcessing: false,
    isSelecting: false,
    observers: new WeakMap(),
    folderChildren: {},
    folderHeaderStatus: {},
    originalNames: new Map(),
};

let cachedSavePreset = null;

export function log(...args) {
    if (state.debug) {
        console.log('[RiyuexiPromptFolders]', ...args);
    }
}

export function setCachedSavePreset(fn) {
    cachedSavePreset = typeof fn === 'function' ? fn : null;
}

export function getPromptId(item) {
    return item?.dataset?.pmIdentifier || item?.dataset?.identifier || '';
}

export function extractPromptName(item) {
    const link = item?.querySelector?.(config.selectors.promptLink);
    if (!link) return '';

    const textNodes = Array.from(link.childNodes).filter(node => node.nodeType === Node.TEXT_NODE);
    const text = textNodes.map(node => node.textContent).join('').trim();
    return text || link.textContent.trim();
}

export function rememberPromptName(item) {
    const id = getPromptId(item);
    if (!id) return;
    state.originalNames.set(id, extractPromptName(item));
}

export function getCurrentPresetName() {
    const select = document.querySelector('#settings_preset_openai');
    const selected = select?.querySelector?.(':checked');
    return selected?.textContent?.trim() || 'default';
}

function normalizeHeaderIds(rawIds) {
    if (!Array.isArray(rawIds)) return [];
    return rawIds
        .map(item => {
            if (typeof item === 'string') return item;
            return item?.id || item?.uuid || item?.identifier || '';
        })
        .filter(Boolean);
}

export function normalizeFolderData(data) {
    if (!data) return null;

    return {
        enabled: data.enabled ?? data.featureEnabled ?? true,
        openStates: data.openStates ?? {},
        folderIds: normalizeHeaderIds(data.folderIds ?? data.manualHeaders ?? []),
        debug: data.debug ?? data.debugMode ?? false,
    };
}

export function loadFromPreset(data) {
    const normalized = normalizeFolderData(data);

    state.enabled = normalized?.enabled ?? true;
    state.openStates = normalized?.openStates ?? {};
    state.folderIds = new Set(normalized?.folderIds ?? []);
    state.debug = normalized?.debug ?? false;

    state.folderChildren = {};
    state.folderHeaderStatus = {};
    state.originalNames = new Map();

    log('Loaded preset data', getStateForSave());
}

export function getStateForSave() {
    return {
        version: 1,
        enabled: state.enabled,
        openStates: state.openStates,
        folderIds: [...state.folderIds],
        debug: state.debug,
    };
}

export async function saveToPreset() {
    try {
        const [
            { oai_settings, openai_settings, openai_setting_names },
            { getRequestHeaders },
        ] = await Promise.all([
            import('../../../../scripts/openai.js'),
            import('../../../../script.js'),
        ]);

        const folderData = getStateForSave();
        oai_settings.extensions ??= {};
        oai_settings.extensions[EXTENSION_KEY] = folderData;

        const presetName = oai_settings.preset_settings_openai || getCurrentPresetName();
        const presetIndex = openai_setting_names[presetName];

        if (presetIndex !== undefined) {
            openai_settings[presetIndex].extensions ??= {};
            openai_settings[presetIndex].extensions[EXTENSION_KEY] = folderData;
        }

        if (cachedSavePreset) {
            await cachedSavePreset(presetName, oai_settings, false);
            return;
        }

        if (presetIndex === undefined) {
            console.error('[RiyuexiPromptFolders] Preset not found:', presetName);
            return;
        }

        const response = await fetch('/api/presets/save', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                apiId: 'openai',
                name: presetName,
                preset: openai_settings[presetIndex],
            }),
        });

        if (!response.ok) {
            console.error('[RiyuexiPromptFolders] Save failed:', response.status, response.statusText);
        }
    } catch (error) {
        console.error('[RiyuexiPromptFolders] saveToPreset failed:', error);
    }
}

export function saveToPresetSoon() {
    saveToPreset().catch(error => console.error('[RiyuexiPromptFolders] Save failed:', error));
}

export async function getCurrentPresetFolderData() {
    try {
        const { oai_settings, openai_settings, openai_setting_names } = await import('../../../../scripts/openai.js');
        const presetName = oai_settings.preset_settings_openai || getCurrentPresetName();
        const presetIndex = openai_setting_names[presetName];
        if (presetIndex === undefined) return null;

        const extensions = openai_settings[presetIndex]?.extensions;
        return extensions?.[EXTENSION_KEY] ?? extensions?.[LEGACY_EXTENSION_KEY] ?? null;
    } catch (error) {
        console.error('[RiyuexiPromptFolders] getCurrentPresetFolderData failed:', error);
        return null;
    }
}

export function getAllPresetNames() {
    return Array.from(document.querySelectorAll('#settings_preset_openai option'))
        .map(option => option.textContent.trim())
        .filter(Boolean);
}

export async function exportConfigFromPreset(presetName) {
    if (presetName === getCurrentPresetName()) {
        return getStateForSave();
    }

    try {
        const { openai_settings, openai_setting_names } = await import('../../../../scripts/openai.js');
        const presetIndex = openai_setting_names[presetName];
        const extensions = openai_settings?.[presetIndex]?.extensions;
        return normalizeFolderData(extensions?.[EXTENSION_KEY] ?? extensions?.[LEGACY_EXTENSION_KEY]);
    } catch (error) {
        console.error('[RiyuexiPromptFolders] exportConfigFromPreset failed:', error);
        return null;
    }
}

export async function importConfigToCurrentPreset(configData, currentPromptItems) {
    const normalized = normalizeFolderData(configData);
    loadFromPreset(normalized);

    const currentIds = new Set(currentPromptItems.map(getPromptId).filter(Boolean));
    const matchedFolderIds = [...state.folderIds].filter(id => currentIds.has(id));
    const missedFolderIds = [...state.folderIds].filter(id => !currentIds.has(id));

    state.folderIds = new Set(matchedFolderIds);
    await saveToPreset();

    return {
        matched: matchedFolderIds.length,
        missed: missedFolderIds.length,
    };
}
