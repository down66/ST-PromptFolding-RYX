export const EXTENSION_KEY = 'riyuexi_prompt_folders';
export const LEGACY_EXTENSION_KEY = 'prompt_folding';
const STORAGE_KEY = 'ryx-prompt-folders-by-preset';

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

    isProcessing: false,
    isSelecting: false,
    folderChildren: {},
    folderHeaderStatus: {},
};

let cachedSavePreset = null;

export function log() {}

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
    };
}

function readLocalStore() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

function writeLocalStore(store) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
        console.warn('[RiyuexiPromptFolders] local backup save failed:', error);
    }
}

function getLocalData(presetName = getCurrentPresetName()) {
    return normalizeFolderData(readLocalStore()[presetName]);
}

function saveLocalData(presetName, data) {
    const store = readLocalStore();
    store[presetName] = data;
    writeLocalStore(store);
}

export function loadFromPreset(data) {
    const normalized = normalizeFolderData(data);

    state.enabled = normalized?.enabled ?? true;
    state.openStates = normalized?.openStates ?? {};
    state.folderIds = new Set(normalized?.folderIds ?? []);

    state.folderChildren = {};
    state.folderHeaderStatus = {};

    log('Loaded folder data', getStateForSave());
}

export function getStateForSave() {
    return {
        version: 2,
        enabled: state.enabled,
        openStates: state.openStates,
        folderIds: [...state.folderIds],
    };
}

export async function saveToPreset() {
    const folderData = getStateForSave();
    const presetName = getCurrentPresetName();
    saveLocalData(presetName, folderData);

    try {
        const [
            { oai_settings, openai_settings, openai_setting_names },
            { getRequestHeaders },
        ] = await Promise.all([
            import('../../../../scripts/openai.js'),
            import('../../../../script.js'),
        ]);

        const activePresetName = oai_settings.preset_settings_openai || presetName;
        oai_settings.extensions ??= {};
        oai_settings.extensions[EXTENSION_KEY] = folderData;

        const presetIndex = openai_setting_names[activePresetName];
        if (presetIndex !== undefined) {
            openai_settings[presetIndex].extensions ??= {};
            openai_settings[presetIndex].extensions[EXTENSION_KEY] = folderData;
        }

        saveLocalData(activePresetName, folderData);

        if (cachedSavePreset) {
            await cachedSavePreset(activePresetName, oai_settings, false);
            return;
        }

        if (presetIndex === undefined) {
            console.warn('[RiyuexiPromptFolders] Preset not found, saved local backup only:', activePresetName);
            return;
        }

        const response = await fetch('/api/presets/save', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                apiId: 'openai',
                name: activePresetName,
                preset: openai_settings[presetIndex],
            }),
        });

        if (!response.ok) {
            console.warn('[RiyuexiPromptFolders] Preset save failed, local backup is kept:', response.status, response.statusText);
        }
    } catch (error) {
        console.warn('[RiyuexiPromptFolders] Preset save failed, local backup is kept:', error);
    }
}

export function saveToPresetSoon() {
    saveToPreset().catch(error => console.warn('[RiyuexiPromptFolders] Save failed:', error));
}

export async function getCurrentPresetFolderData() {
    const fallbackName = getCurrentPresetName();

    try {
        const { oai_settings, openai_settings, openai_setting_names } = await import('../../../../scripts/openai.js');
        const presetName = oai_settings.preset_settings_openai || fallbackName;
        const presetIndex = openai_setting_names[presetName];
        const extensions = presetIndex === undefined ? null : openai_settings[presetIndex]?.extensions;
        const presetData = normalizeFolderData(extensions?.[EXTENSION_KEY] ?? extensions?.[LEGACY_EXTENSION_KEY]);
        return presetData ?? getLocalData(presetName) ?? null;
    } catch (error) {
        console.warn('[RiyuexiPromptFolders] getCurrentPresetFolderData fell back to local backup:', error);
        return getLocalData(fallbackName) ?? null;
    }
}
