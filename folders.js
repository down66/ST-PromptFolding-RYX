import {
    config,
    extractPromptName,
    getPromptId,
    log,
    rememberPromptName,
    saveToPreset,
    saveToPresetSoon,
    state,
} from './state.js';

let saveTimer = null;

function debounceSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveToPresetSoon(), 600);
}

export function getPromptItems(listContainer) {
    return Array.from(listContainer?.querySelectorAll(config.selectors.promptListItem) ?? []);
}

export function flattenPromptList(listContainer) {
    if (!listContainer || state.isProcessing) return [];

    state.isProcessing = true;
    try {
        const items = getPromptItems(listContainer);
        listContainer.innerHTML = '';
        items.forEach(item => {
            cleanPromptItem(item);
            listContainer.appendChild(item);
        });
        return items;
    } finally {
        state.isProcessing = false;
    }
}

function cleanPromptItem(item) {
    item.classList.remove(config.classNames.folderHeader, config.classNames.controlledByFolder);
    item.querySelector('.ryx-folder-picker')?.remove();

    const link = item.querySelector(config.selectors.promptLink);
    if (link?.dataset.ryxFolderClick === '1') {
        link.onclick = null;
        delete link.dataset.ryxFolderClick;
    }

    const nameSpan = item.querySelector(config.selectors.promptNameSpan);
    if (nameSpan?.dataset.ryxFolderClick === '1') {
        nameSpan.onclick = null;
        delete nameSpan.dataset.ryxFolderClick;
    }

    rememberPromptName(item);
}

function createChevron(details) {
    const button = document.createElement('button');
    button.className = 'ryx-folder-chevron';
    button.type = 'button';
    button.title = '展开/收起';
    button.innerHTML = '<i class="fa-solid fa-angle-right"></i>';
    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        details.open = !details.open;
    });
    return button;
}

function createFolderDOM(headerItem, childItems) {
    const folderId = getPromptId(headerItem);
    const folderName = extractPromptName(headerItem);

    state.folderChildren[folderId] = childItems.map(getPromptId).filter(Boolean);
    state.folderHeaderStatus[folderId] = !headerItem.classList.contains('completion_prompt_manager_prompt_disabled');

    headerItem.classList.add(config.classNames.folderHeader);

    const details = document.createElement('details');
    details.className = config.classNames.folder;
    details.open = state.openStates[folderId] !== false;
    details.dataset.folderId = folderId;
    details.dataset.folderName = folderName;

    const summary = document.createElement('summary');
    summary.className = 'ryx-folder-summary';
    summary.dataset.count = String(childItems.length);

    summary.addEventListener('click', event => {
        if (event.target === summary) {
            event.preventDefault();
            details.open = !details.open;
        }
    });

    const link = headerItem.querySelector(config.selectors.promptLink);
    if (link) {
        link.dataset.ryxFolderClick = '1';
        link.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
        };
    }

    const nameSpan = headerItem.querySelector(config.selectors.promptNameSpan);
    if (nameSpan) {
        nameSpan.dataset.ryxFolderClick = '1';
        nameSpan.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            details.open = !details.open;
        };
    }

    summary.append(createChevron(details), headerItem);
    details.appendChild(summary);

    const content = document.createElement('div');
    content.className = config.classNames.folderContent;
    childItems.forEach(item => content.appendChild(item));
    details.appendChild(content);

    details.addEventListener('toggle', () => {
        state.openStates[folderId] = details.open;
        debounceSave();
    });

    return details;
}

function pruneMissingFolderIds(promptItems) {
    const liveIds = new Set(promptItems.map(getPromptId).filter(Boolean));
    let changed = false;

    for (const id of [...state.folderIds]) {
        if (!liveIds.has(id)) {
            state.folderIds.delete(id);
            delete state.openStates[id];
            changed = true;
        }
    }

    if (changed) debounceSave();
}

export function buildFolderGroups(listContainer) {
    if (!listContainer || state.isProcessing) return;

    state.isProcessing = true;
    try {
        const allItems = getPromptItems(listContainer);

        if (state.isSelecting) {
            listContainer.innerHTML = '';
            allItems.forEach(item => listContainer.appendChild(item));
            return;
        }

        allItems.forEach(cleanPromptItem);
        pruneMissingFolderIds(allItems);

        listContainer.innerHTML = '';
        state.folderChildren = {};
        state.folderHeaderStatus = {};

        if (!state.enabled || state.isSelecting || state.folderIds.size === 0) {
            allItems.forEach(item => listContainer.appendChild(item));
            return;
        }

        let currentHeader = null;
        let buffer = [];

        const flush = () => {
            if (currentHeader) {
                listContainer.appendChild(createFolderDOM(currentHeader, buffer));
            } else {
                buffer.forEach(item => listContainer.appendChild(item));
            }
            currentHeader = null;
            buffer = [];
        };

        allItems.forEach(item => {
            const id = getPromptId(item);
            if (id && state.folderIds.has(id)) {
                flush();
                currentHeader = item;
                buffer = [];
            } else {
                buffer.push(item);
            }
        });

        flush();
        applyDisabledFolderStyles(listContainer);
        log('Built folders:', Object.keys(state.folderChildren).length);
    } catch (error) {
        console.error('[RiyuexiPromptFolders] buildFolderGroups failed:', error);
    } finally {
        state.isProcessing = false;
    }
}

export function toggleAllFolders(listContainer, shouldOpen) {
    const folders = listContainer?.querySelectorAll?.(`.${config.classNames.folder}`) ?? [];
    folders.forEach(folder => {
        folder.open = shouldOpen;
        if (folder.dataset.folderId) {
            state.openStates[folder.dataset.folderId] = shouldOpen;
        }
    });
    saveToPreset().catch(error => console.error('[RiyuexiPromptFolders] Save failed:', error));
}

export function applyDisabledFolderStyles(listContainer) {
    const folders = listContainer?.querySelectorAll?.(`.${config.classNames.folder}`) ?? [];

    folders.forEach(folder => {
        const id = folder.dataset.folderId;
        const isDisabled = state.folderHeaderStatus[id] === false;
        const childItems = folder.querySelectorAll(`.${config.classNames.folderContent} > ${config.selectors.promptListItem}`);

        childItems.forEach(item => {
            item.classList.toggle(config.classNames.controlledByFolder, isDisabled);
        });
    });
}
