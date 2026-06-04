import {
    config,
    extractPromptName,
    getPromptId,
    log,
    saveToPreset,
    saveToPresetSoon,
    state,
} from './state.js';

let saveTimer = null;
const dragState = {
    folder: null,
    listContainer: null,
    moved: false,
    dropTarget: null,
    dropPlacement: null,
};

function debounceSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveToPresetSoon(), 450);
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

    const tokenCounter = item.querySelector('.prompt_manager_prompt_tokens');
    if (tokenCounter?.dataset.ryxOriginalTokens !== undefined) {
        tokenCounter.textContent = tokenCounter.dataset.ryxOriginalTokens;
        delete tokenCounter.dataset.ryxOriginalTokens;
        delete tokenCounter.dataset.ryxFolderActiveCount;
    }

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
}

function setFolderOpen(details, shouldOpen, animate = true) {
    if (!details || details.dataset.ryxAnimating === '1') return;

    const folderId = details.dataset.folderId;
    const content = details.querySelector(`.${config.classNames.folderContent}`);
    state.openStates[folderId] = shouldOpen;
    debounceSave();

    if (!content || !animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        details.open = shouldOpen;
        return;
    }

    details.dataset.ryxAnimating = '1';
    content.style.overflow = 'hidden';
    content.style.transition = 'max-height 180ms ease, opacity 160ms ease, transform 180ms ease';

    if (shouldOpen) {
        details.open = true;
        content.style.maxHeight = '0px';
        content.style.opacity = '0';
        content.style.transform = 'translateY(-3px)';

        requestAnimationFrame(() => {
            content.style.maxHeight = `${content.scrollHeight}px`;
            content.style.opacity = '1';
            content.style.transform = 'translateY(0)';
        });
    } else {
        content.style.maxHeight = `${content.scrollHeight}px`;
        content.style.opacity = '1';
        content.style.transform = 'translateY(0)';

        requestAnimationFrame(() => {
            content.style.maxHeight = '0px';
            content.style.opacity = '0';
            content.style.transform = 'translateY(-3px)';
        });
    }

    window.setTimeout(() => {
        if (!shouldOpen) {
            details.open = false;
        }
        content.style.overflow = '';
        content.style.transition = '';
        content.style.maxHeight = '';
        content.style.opacity = '';
        content.style.transform = '';
        delete details.dataset.ryxAnimating;
    }, 210);
}

function createChevron() {
    const button = document.createElement('button');
    button.className = 'ryx-folder-chevron';
    button.type = 'button';
    button.title = '展开/收起';
    button.innerHTML = '<i class="fa-solid fa-angle-right"></i>';
    return button;
}

function isInteractiveTarget(target) {
    return Boolean(target?.closest?.([
        'button',
        'input',
        'select',
        'textarea',
        '.prompt-manager-edit-action',
        '.prompt-manager-toggle-action',
        '.prompt-manager-detach-action',
    ].join(',')));
}

function clearDropHint() {
    if (!dragState.dropTarget) return;
    dragState.dropTarget.classList.remove('ryx-folder-drop-before', 'ryx-folder-drop-after');
    dragState.dropTarget = null;
    dragState.dropPlacement = null;
}

function getTopLevelBlock(target, listContainer) {
    const folder = target?.closest?.(`.${config.classNames.folder}`);
    if (folder?.parentElement === listContainer) return folder;

    const promptItem = target?.closest?.(config.selectors.promptListItem);
    if (promptItem?.parentElement === listContainer) return promptItem;

    return null;
}

function getDropPlacement(block, clientY) {
    const summary = block.matches?.(`.${config.classNames.folder}`)
        ? block.querySelector(':scope > .ryx-folder-summary')
        : null;
    const rect = (summary || block).getBoundingClientRect();
    return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function moveDraggedFolder(block, placement) {
    if (!dragState.folder || block === dragState.folder) return;

    const listContainer = dragState.listContainer;
    if (!listContainer || block.parentElement !== listContainer) return;

    clearDropHint();
    block.classList.add(placement === 'before' ? 'ryx-folder-drop-before' : 'ryx-folder-drop-after');
    dragState.dropTarget = block;
    dragState.dropPlacement = placement;

    if (placement === 'before') {
        if (dragState.folder.nextElementSibling !== block) {
            listContainer.insertBefore(dragState.folder, block);
            dragState.moved = true;
        }
        return;
    }

    const nextBlock = block.nextElementSibling;
    if (nextBlock !== dragState.folder) {
        listContainer.insertBefore(dragState.folder, nextBlock);
        dragState.moved = true;
    }
}

async function syncPromptOrderFromItems(promptItems) {
    try {
        const { promptManager } = await import('../../../../scripts/openai.js');
        const character = promptManager?.activeCharacter;
        const currentOrder = promptManager?.getPromptOrderForCharacter?.(character);

        if (!character || !Array.isArray(currentOrder) || currentOrder.length === 0) {
            return false;
        }

        const idToEntry = new Map(currentOrder.map(entry => [entry.identifier, entry]));
        const seenIds = new Set();
        const nextOrder = [];

        promptItems.forEach(item => {
            const id = getPromptId(item);
            const entry = idToEntry.get(id);
            if (!entry || seenIds.has(id)) return;
            nextOrder.push(entry);
            seenIds.add(id);
        });

        currentOrder.forEach(entry => {
            if (!entry?.identifier || seenIds.has(entry.identifier)) return;
            nextOrder.push(entry);
        });

        if (nextOrder.length === 0) return false;

        if (promptManager.removePromptOrderForCharacter && promptManager.addPromptOrderForCharacter) {
            promptManager.removePromptOrderForCharacter(character);
            promptManager.addPromptOrderForCharacter(character, nextOrder);
        } else {
            currentOrder.splice(0, currentOrder.length, ...nextOrder);
        }

        await promptManager.saveServiceSettings?.();
        return true;
    } catch (error) {
        console.warn('[RiyuexiPromptFolders] Prompt order sync failed:', error);
        return false;
    }
}

async function commitFolderDrag() {
    const listContainer = dragState.listContainer;
    const shouldCommit = dragState.moved && listContainer;

    dragState.folder?.classList.remove('ryx-folder-dragging');
    listContainer?.classList.remove('ryx-folder-drag-active');
    document.body.classList.remove('ryx-folder-drag-active');
    clearDropHint();

    dragState.folder = null;
    dragState.listContainer = null;
    dragState.moved = false;

    if (!shouldCommit) return;

    const promptItems = flattenPromptList(listContainer);
    await syncPromptOrderFromItems(promptItems);
    buildFolderGroups(listContainer);
    saveToPresetSoon();
}

export function setupFolderDrag(listContainer) {
    if (!listContainer || listContainer.dataset.ryxFolderDragBound === '1') return;

    listContainer.dataset.ryxFolderDragBound = '1';

    listContainer.addEventListener('dragstart', event => {
        const summary = event.target.closest?.('.ryx-folder-summary');
        const folder = summary?.closest?.(`.${config.classNames.folder}`);
        if (!summary || !folder || isInteractiveTarget(event.target) || state.isSelecting) return;

        dragState.folder = folder;
        dragState.listContainer = listContainer;
        dragState.moved = false;

        folder.classList.add('ryx-folder-dragging');
        listContainer.classList.add('ryx-folder-drag-active');
        document.body.classList.add('ryx-folder-drag-active');

        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', folder.dataset.folderId || '');
        event.stopPropagation();
    });

    listContainer.addEventListener('dragover', event => {
        if (!dragState.folder || dragState.listContainer !== listContainer) return;

        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';

        const block = getTopLevelBlock(event.target, listContainer);
        if (!block || block === dragState.folder) return;

        moveDraggedFolder(block, getDropPlacement(block, event.clientY));
    });

    listContainer.addEventListener('drop', event => {
        if (!dragState.folder || dragState.listContainer !== listContainer) return;
        event.preventDefault();
        event.stopPropagation();
    });

    listContainer.addEventListener('dragend', () => {
        if (!dragState.folder || dragState.listContainer !== listContainer) return;
        commitFolderDrag().catch(error => console.warn('[RiyuexiPromptFolders] Folder drag commit failed:', error));
    });
}

function isPromptEnabled(item) {
    return !item.classList.contains('completion_prompt_manager_prompt_disabled');
}

function setFolderCounter(headerItem, childItems) {
    const enabledCount = childItems.filter(isPromptEnabled).length;
    const tokenCounter = headerItem.querySelector('.prompt_manager_prompt_tokens');

    if (!tokenCounter) return;
    if (tokenCounter.dataset.ryxOriginalTokens === undefined) {
        tokenCounter.dataset.ryxOriginalTokens = tokenCounter.textContent;
    }

    tokenCounter.dataset.ryxFolderActiveCount = '1';
    tokenCounter.textContent = `${enabledCount}/${childItems.length}`;
    tokenCounter.title = `已启用条目/全部条目：${enabledCount}/${childItems.length}`;
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
    summary.draggable = true;
    summary.title = '拖动可移动整个文件夹，点击名称可展开/收起';
    setFolderCounter(headerItem, childItems);

    const chevron = createChevron();
    const toggle = event => {
        event.preventDefault();
        event.stopPropagation();
        setFolderOpen(details, !details.open, true);
    };

    summary.addEventListener('click', event => {
        if (event.target === summary) {
            toggle(event);
        }
    });
    summary.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            toggle(event);
        }
    });
    chevron.addEventListener('click', toggle);

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
        nameSpan.onclick = toggle;
    }

    summary.append(chevron, headerItem);
    details.appendChild(summary);

    const content = document.createElement('div');
    content.className = config.classNames.folderContent;
    childItems.forEach(item => content.appendChild(item));
    details.appendChild(content);

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

        if (!state.enabled || state.folderIds.size === 0) {
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
    saveToPreset().catch(error => console.warn('[RiyuexiPromptFolders] Save failed:', error));
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
