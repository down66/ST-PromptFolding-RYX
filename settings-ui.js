import { buildFolderGroups, flattenPromptList, getPromptItems, toggleAllFolders } from './folders.js';
import {
    config,
    getCurrentPresetName,
    getPromptId,
    loadFromPreset,
    saveToPreset,
    saveToPresetSoon,
    state,
} from './state.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';

let listContainerRef = null;
let selectionSnapshot = null;

export async function createSettingsPanel(promptManagerContainer, listContainer) {
    listContainerRef = listContainer;

    if (document.getElementById('ryx-folder-settings')) {
        updateSettingsUI();
        return;
    }

    try {
        const response = await fetch(new URL('./settings.html', import.meta.url));
        const html = await response.text();
        const header = promptManagerContainer.querySelector(config.selectors.promptHeader);
        (header || promptManagerContainer).insertAdjacentHTML(header ? 'afterend' : 'beforebegin', html);
        initSettingsLogic();
    } catch (error) {
        console.error('[RiyuexiPromptFolders] Failed to load settings panel:', error);
    }
}

function getElements() {
    return {
        panel: document.getElementById('ryx-folder-settings'),
        enabled: document.getElementById('ryx-folder-enabled'),
        start: document.getElementById('ryx-folder-start'),
        reset: document.getElementById('ryx-folder-reset'),
        expand: document.getElementById('ryx-folder-expand-all'),
        collapse: document.getElementById('ryx-folder-collapse-all'),
        folderCount: document.getElementById('ryx-folder-count'),
        promptCount: document.getElementById('ryx-prompt-count'),
        currentPreset: document.getElementById('ryx-current-preset'),
    };
}

function initSettingsLogic() {
    const els = getElements();

    els.enabled.addEventListener('change', () => {
        state.enabled = els.enabled.checked;
        saveToPresetSoon();
        refreshList();
        updateSettingsUI();
    });

    els.start.addEventListener('click', () => startFolderSelection());
    els.expand.addEventListener('click', () => toggleAllFolders(listContainerRef, true));
    els.collapse.addEventListener('click', () => toggleAllFolders(listContainerRef, false));
    els.reset.addEventListener('click', handleReset);

    loadManifestInfo();
    updateSettingsUI();
}

function refreshList() {
    if (listContainerRef) {
        buildFolderGroups(listContainerRef);
    }
}

export function updateSettingsUI() {
    const els = getElements();
    if (!els.panel) return;

    const promptItems = listContainerRef ? getPromptItems(listContainerRef) : [];
    const promptIds = new Set(promptItems.map(getPromptId).filter(Boolean));
    const liveFolderCount = [...state.folderIds].filter(id => promptIds.has(id)).length;

    els.enabled.checked = state.enabled;
    els.folderCount.textContent = String(liveFolderCount);
    els.promptCount.textContent = String(promptItems.length);
    els.currentPreset.textContent = getCurrentPresetName();

    if (state.isSelecting) {
        els.start.classList.add('is-working');
        els.start.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>整理中</span>';
    } else {
        els.start.classList.remove('is-working');
        els.start.innerHTML = '<i class="fa-solid fa-folder-plus"></i><span>整理文件夹</span>';
    }
}

export function startFolderSelection() {
    if (!listContainerRef) {
        toastr.error('找不到提示词列表');
        return;
    }

    if (state.isSelecting) return;

    selectionSnapshot = new Set(state.folderIds);
    state.isSelecting = true;

    const promptItems = flattenPromptList(listContainerRef);

    promptItems.forEach(item => {
        if (item.querySelector('.ryx-folder-picker')) return;

        const id = getPromptId(item);
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'ryx-folder-picker';
        checkbox.checked = state.folderIds.has(id);
        checkbox.title = '设为文件夹';

        checkbox.addEventListener('click', event => event.stopPropagation());
        checkbox.addEventListener('change', event => {
            event.stopPropagation();
            if (!id) return;
            if (checkbox.checked) {
                state.folderIds.add(id);
            } else {
                state.folderIds.delete(id);
                delete state.openStates[id];
            }
            updateFloatingCount();
            updateSettingsUI();
        });

        item.insertBefore(checkbox, item.firstChild);
    });

    createFloatingPanel();
    updateFloatingCount();
    updateSettingsUI();
    toastr.info('勾选文件夹标题，然后把条目拖到它下面');
}

function createFloatingPanel() {
    document.getElementById('ryx-folder-float-wrapper')?.remove();

    const wrapper = document.createElement('div');
    wrapper.id = 'ryx-folder-float-wrapper';
    wrapper.innerHTML = `
        <div id="ryx-folder-float-panel">
            <span id="ryx-folder-float-count"></span>
            <button type="button" id="ryx-folder-float-apply" title="完成"><i class="fa-solid fa-check"></i></button>
            <button type="button" id="ryx-folder-float-cancel" title="取消"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `;

    const host = document.getElementById('left-nav-panel') || document.body;
    host.appendChild(wrapper);

    document.getElementById('ryx-folder-float-apply').addEventListener('click', finishFolderSelection);
    document.getElementById('ryx-folder-float-cancel').addEventListener('click', cancelFolderSelection);
}

function updateFloatingCount() {
    const count = document.getElementById('ryx-folder-float-count');
    if (count) {
        count.textContent = `文件夹 ${state.folderIds.size}`;
    }
}

async function finishFolderSelection() {
    state.isSelecting = false;
    selectionSnapshot = null;

    document.querySelectorAll('.ryx-folder-picker').forEach(checkbox => checkbox.remove());
    document.getElementById('ryx-folder-float-wrapper')?.remove();

    refreshList();
    updateSettingsUI();
    await saveToPreset();
    toastr.success(`已保存 ${state.folderIds.size} 个文件夹`);
}

export function cancelFolderSelection() {
    if (!state.isSelecting) return;

    state.isSelecting = false;

    if (selectionSnapshot) {
        state.folderIds = new Set(selectionSnapshot);
        selectionSnapshot = null;
    }

    document.querySelectorAll('.ryx-folder-picker').forEach(checkbox => checkbox.remove());
    document.getElementById('ryx-folder-float-wrapper')?.remove();

    refreshList();
    updateSettingsUI();
    toastr.info('已取消整理');
}

async function handleReset() {
    const confirmed = await callGenericPopup(
        '<div>确定重置当前预设的文件夹设置吗？</div>',
        POPUP_TYPE.CONFIRM,
        '',
        { okButton: '重置', cancelButton: '取消' },
    );

    if (!confirmed) return;

    loadFromPreset(null);
    refreshList();
    updateSettingsUI();
    await saveToPreset();
    toastr.info('已重置文件夹设置');
}

function loadManifestInfo() {
    fetch(new URL('./manifest.json', import.meta.url))
        .then(response => response.json())
        .then(manifest => {
            const version = document.getElementById('ryx-folder-version');
            if (version) {
                version.textContent = `v${manifest.version}`;
            }
        })
        .catch(() => {});
}
