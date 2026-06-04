import { eventSource, event_types } from '../../../../script.js';
import {
    config,
    getCurrentPresetFolderData,
    getStateForSave,
    loadFromPreset,
    log,
    saveToPresetSoon,
    setCachedSavePreset,
    state,
    EXTENSION_KEY,
} from './state.js';
import { buildFolderGroups, toggleAllFolders } from './folders.js';
import {
    applyFoldSettings,
    cancelFolderSelection,
    createSettingsPanel,
    startFolderSelection,
    updateSettingsUI,
} from './settings-ui.js';

let promptManagerHooked = false;

function createIconButton(icon, title, onClick, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ryx-toolbar-btn ${className}`;
    button.title = title;
    button.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    button.addEventListener('click', onClick);
    return button;
}

function createToolbar(listContainer) {
    const header = document.querySelector(config.selectors.promptHeader);
    if (!header) return;

    header.querySelector('.ryx-folder-toolbar')?.remove();

    const toolbar = document.createElement('div');
    toolbar.className = 'ryx-folder-toolbar';

    const organizeButton = createIconButton('fa-folder-plus', '整理文件夹', () => {
        startFolderSelection();
    }, 'ryx-organize');

    const expandButton = createIconButton('fa-up-right-and-down-left-from-center', '全部展开', () => {
        toggleAllFolders(listContainer, true);
    });

    const collapseButton = createIconButton('fa-down-left-and-up-right-to-center', '全部收起', () => {
        toggleAllFolders(listContainer, false);
    });

    const enabledButton = createIconButton('fa-toggle-on', '启用/停用文件夹', () => {
        state.enabled = !state.enabled;
        enabledButton.classList.toggle('is-off', !state.enabled);
        enabledButton.innerHTML = `<i class="fa-solid ${state.enabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>`;
        enabledButton.title = state.enabled ? '点击停用文件夹' : '点击启用文件夹';
        buildFolderGroups(listContainer);
        updateSettingsUI();
        saveToPresetSoon();
    }, 'ryx-enabled');

    enabledButton.classList.toggle('is-off', !state.enabled);
    enabledButton.innerHTML = `<i class="fa-solid ${state.enabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>`;

    const settingsButton = createIconButton('fa-wand-magic-sparkles', '文件夹面板', () => {
        const panel = document.getElementById('ryx-folder-settings');
        if (!panel) return;
        const shouldShow = panel.style.display === 'none' || !panel.style.display;
        panel.style.display = shouldShow ? 'block' : 'none';
        settingsButton.classList.toggle('is-active', shouldShow);
        updateSettingsUI();
    }, 'ryx-settings-toggle');

    toolbar.append(organizeButton, expandButton, collapseButton, enabledButton, settingsButton);
    header.appendChild(toolbar);
}

function observePromptList(listContainer) {
    state.observers.get(listContainer)?.disconnect();

    const observer = new MutationObserver(mutations => {
        if (state.isProcessing || state.isSelecting) return;

        const isPromptNode = node => {
            return node.nodeType === Node.ELEMENT_NODE
                && (node.matches(config.selectors.promptListItem) || node.querySelector(config.selectors.promptListItem));
        };

        const shouldRebuild = mutations.some(mutation => {
            if (mutation.type === 'childList') {
                return [...mutation.addedNodes].some(isPromptNode) || [...mutation.removedNodes].some(isPromptNode);
            }

            if (mutation.type === 'characterData') {
                return !!mutation.target.parentElement?.closest?.(config.selectors.promptListItem);
            }

            if (mutation.type === 'attributes') {
                return mutation.target.matches?.(config.selectors.promptListItem);
            }

            return false;
        });

        if (!shouldRebuild) return;

        observer.disconnect();
        buildFolderGroups(listContainer);
        setTimeout(() => {
            observer.observe(listContainer, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['class', 'data-pm-identifier'],
            });
        }, 120);
    });

    observer.observe(listContainer, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'data-pm-identifier'],
    });

    state.observers.set(listContainer, observer);
}

function setupDragRefresh(listContainer) {
    if (listContainer.dataset.ryxDragRefresh === '1') return;
    listContainer.dataset.ryxDragRefresh = '1';

    listContainer.addEventListener('dragstart', event => {
        if (event.target.closest(config.selectors.promptListItem)) {
            state.observers.get(listContainer)?.disconnect();
        }
    });

    listContainer.addEventListener('dragend', () => {
        setTimeout(() => {
            if (!state.isSelecting) {
                buildFolderGroups(listContainer);
            }
            state.observers.get(listContainer)?.observe(listContainer, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['class', 'data-pm-identifier'],
            });
            updateSettingsUI();
        }, 160);
    });
}

function updateFolderHeaderStatus(promptManager) {
    const character = promptManager.activeCharacter;
    if (!character) return;

    const order = promptManager.getPromptOrderForCharacter(character);
    Object.keys(state.folderChildren).forEach(folderId => {
        const entry = order.find(item => item.identifier === folderId);
        if (entry) {
            state.folderHeaderStatus[folderId] = entry.enabled;
        }
    });
}

function hookPromptManager(promptManager) {
    if (promptManagerHooked || !promptManager?.getPromptCollection) return;

    const originalGetPromptCollection = promptManager.getPromptCollection.bind(promptManager);

    promptManager.getPromptCollection = function(type) {
        const collection = originalGetPromptCollection(type);
        if (!state.enabled) return collection;

        updateFolderHeaderStatus(promptManager);

        const disabledIds = new Set();
        Object.entries(state.folderChildren).forEach(([folderId, childIds]) => {
            if (state.folderHeaderStatus[folderId] === false) {
                childIds.forEach(id => disabledIds.add(id));
            }
        });

        if (disabledIds.size > 0 && Array.isArray(collection?.collection)) {
            collection.collection = collection.collection.filter(prompt => !disabledIds.has(prompt.identifier));
        }

        return collection;
    };

    promptManagerHooked = true;
    log('Prompt manager hook installed');
}

function installPromptManagerHook() {
    if (promptManagerHooked) return;

    import('../../../../scripts/openai.js').then(module => {
        const timer = setInterval(() => {
            if (module.promptManager?.serviceSettings) {
                clearInterval(timer);
                hookPromptManager(module.promptManager);
            }
        }, 100);

        setTimeout(() => clearInterval(timer), 5000);
    });
}

async function initialize(listContainer) {
    const promptManagerContainer = listContainer.closest(config.selectors.promptManager);
    if (!promptManagerContainer) return;

    const folderData = await getCurrentPresetFolderData();
    loadFromPreset(folderData);
    cancelFolderSelection();

    await createSettingsPanel(promptManagerContainer, listContainer);
    if (localStorage.getItem('ryx-fold-openai-settings') === '1') {
        applyFoldSettings(true);
    }

    createToolbar(listContainer);
    buildFolderGroups(listContainer);
    observePromptList(listContainer);
    setupDragRefresh(listContainer);
    installPromptManagerHook();
    updateSettingsUI();

    log('Initialized');
}

const bodyObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.matches(config.selectors.promptList)) {
                initialize(node);
                return;
            }

            const list = node.querySelector?.(config.selectors.promptList);
            if (list) {
                initialize(list);
                return;
            }
        }
    }
});

bodyObserver.observe(document.body, { childList: true, subtree: true });

const initialList = document.querySelector(config.selectors.promptList);
if (initialList) {
    initialize(initialList);
}

eventSource.on(event_types.OAI_PRESET_CHANGED_BEFORE, ({ preset, savePreset }) => {
    setCachedSavePreset(savePreset);
    cancelFolderSelection();
    loadFromPreset(preset.extensions?.[EXTENSION_KEY] ?? preset.extensions?.prompt_folding);
    log('Loaded data before preset change');
});

eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => {
    const listContainer = document.querySelector(config.selectors.promptList);
    if (!listContainer) return;
    buildFolderGroups(listContainer);
    updateSettingsUI();
    if (localStorage.getItem('ryx-fold-openai-settings') === '1') {
        applyFoldSettings(true);
    }
});

eventSource.on(event_types.OAI_PRESET_EXPORT_READY, preset => {
    preset.extensions ??= {};
    preset.extensions[EXTENSION_KEY] = getStateForSave();
});

eventSource.on(event_types.OAI_PRESET_IMPORT_READY, ({ data }) => {
    const folderData = data?.extensions?.[EXTENSION_KEY] ?? data?.extensions?.prompt_folding;
    if (folderData) {
        loadFromPreset(folderData);
    }
});
