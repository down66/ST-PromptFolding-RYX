import { config, state, log, loadFromPreset, saveToPreset, setCachedSavePreset, getStateForSave, getCurrentPresetFoldingData } from './state.js';
import { buildCollapsibleGroups, toggleAllGroups } from './prompt-folding.js';
import { createSettingsPanel, cancelManualSelection, updateSettingsUI, applyFoldSettings } from './settings-ui.js';
import { eventSource, event_types } from '../../../../script.js';

let isHooked = false;

// --- 1. List content observer ---
function createListContentObserver(listContainer) {
    if (state.observers.has(listContainer)) state.observers.get(listContainer).disconnect();

    const observer = new MutationObserver((mutations) => {
        if (state.isProcessing) return;

        const isPromptNode = (n) => n.nodeType === 1 && (n.matches(config.selectors.promptListItem) || n.querySelector(config.selectors.promptListItem));

        const shouldRebuild = mutations.some(m => {
            if (m.type === 'childList' && (Array.from(m.addedNodes).some(isPromptNode) || Array.from(m.removedNodes).some(isPromptNode))) {
                log('Detected childList change, rebuilding');
                return true;
            }
            if (m.type === 'characterData') {
                const target = m.target.parentElement;
                if (target && target.matches(config.selectors.promptLink)) {
                    log('Prompt name changed, rebuilding');
                    return true;
                }
            }
            return false;
        });

        if (shouldRebuild) {
            observer.disconnect();
            buildCollapsibleGroups(listContainer);
            setTimeout(() => observer.observe(listContainer, { childList: true, subtree: true, characterData: true }), 100);
        }
    });

    observer.observe(listContainer, { childList: true, subtree: true, characterData: true });
    state.observers.set(listContainer, observer);
}

// --- 2. Drag handlers ---
function setupDragHandlers(listContainer) {
    listContainer.addEventListener('dragstart', (e) => {
        if (e.target.closest(config.selectors.promptListItem)) {
            state.observers.get(listContainer)?.disconnect();
        }
    });

    listContainer.addEventListener('dragend', () => {
        setTimeout(() => {
            buildCollapsibleGroups(listContainer);
            state.observers.get(listContainer)?.observe(listContainer, { childList: true, subtree: true, characterData: true });
        }, 150);
    });
}

// --- 3. Toolbar button helpers ---
function createBtn(label, title, onClick, className = '') {
    const btn = document.createElement('button');
    btn.className = `menu_button ${className}`.trim();
    btn.textContent = label;
    btn.title = title;
    btn.onclick = onClick;
    return btn;
}

function setupToggleButton(listContainer) {
    const header = document.querySelector('.completion_prompt_manager_header');
    if (!header) return;

    header.querySelector('.pf-collapse-controls')?.remove();

    const container = document.createElement('div');
    container.className = 'pf-collapse-controls';

    // Folder icon for expand/collapse all
    container.append(
        createBtn('📂', 'Expand All', () => toggleAllGroups(listContainer, true), ''),
        createBtn('📁', 'Collapse All', () => toggleAllGroups(listContainer, false), ''),
    );

    // Toggle enable/disable
    const toggleBtn = createBtn('', '', () => {
        state.isEnabled = !state.isEnabled;
        saveToPreset().catch(err => console.error('[PF] Save failed:', err));
        updateToggleState();
        buildCollapsibleGroups(listContainer);
    });

    const updateToggleState = () => {
        toggleBtn.textContent = state.isEnabled ? '🟢' : '🔴';
        toggleBtn.title = state.isEnabled ? 'Click to Disable' : 'Click to Enable';
    };
    updateToggleState();
    container.append(toggleBtn);

    // Settings gear button
    const settingsBtn = createBtn('⚙', 'Group Settings', () => {
        const panel = document.getElementById('pf-settings-panel');
        if (panel) {
            const isHidden = panel.style.display === 'none';
            panel.style.display = isHidden ? 'block' : 'none';
            settingsBtn.classList.toggle('active', isHidden);
        }
    }, 'pf-settings-toggle');
    container.append(settingsBtn);

    const target = header.firstElementChild?.nextSibling || header.firstChild;
    header.insertBefore(container, target);
}

// --- 4. Hook the prompt manager ---
function hookPromptManager(pm) {
    const originalGet = pm.getPromptCollection.bind(pm);

    pm.getPromptCollection = function(type) {
        const collection = originalGet(type);
        if (!state.isEnabled) return collection;

        updateGroupHeaderStatus(pm);

        const disabledIds = new Set();
        for (const [groupKey, childIds] of Object.entries(state.groupHierarchy)) {
            if (state.groupHeaderStatus[groupKey] === false) {
                childIds.forEach(id => disabledIds.add(id));
            }
        }

        if (disabledIds.size > 0) {
            collection.collection = collection.collection.filter(p => !disabledIds.has(p.identifier));
        }

        return collection;
    };
    log('Hook installed.');
}

function updateGroupHeaderStatus(pm) {
    const char = pm.activeCharacter;
    if (!char) return;

    const order = pm.getPromptOrderForCharacter(char);
    Object.keys(state.groupHierarchy).forEach(headerId => {
        const entry = order.find(e => e.identifier === headerId);
        if (entry) state.groupHeaderStatus[headerId] = entry.enabled;
    });
}

// --- 5. Initialize ---
async function initialize(listContainer) {
    const pmWrapper = listContainer.closest('#completion_prompt_manager');
    if (!pmWrapper) return;

    const pfData = await getCurrentPresetFoldingData();
    loadFromPreset(pfData);

    cancelManualSelection();
    log('Initializing Prompt Folding...');

    createSettingsPanel(pmWrapper, listContainer);
    if (localStorage.getItem('pf-fold-settings') === '1') applyFoldSettings(true);
    setupToggleButton(listContainer);
    buildCollapsibleGroups(listContainer);
    createListContentObserver(listContainer);
    setupDragHandlers(listContainer);

    log('Initialization complete');

    if (!isHooked) {
        import('../../../../scripts/openai.js').then(m => {
            const check = setInterval(() => {
                if (m.promptManager?.serviceSettings) {
                    clearInterval(check);
                    hookPromptManager(m.promptManager);
                    isHooked = true;
                }
            }, 100);
            setTimeout(() => clearInterval(check), 5000);
        });
    }
}

// Observer for prompt list appearing in DOM
const globalObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
        for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches(config.selectors.promptList)) return initialize(node);
            const list = node.querySelector(config.selectors.promptList);
            if (list) return initialize(list);
        }
    }
});
globalObserver.observe(document.body, { childList: true, subtree: true });

const initialList = document.querySelector(config.selectors.promptList);
if (initialList) initialize(initialList);

// --- 6. Preset events ---
eventSource.on(event_types.OAI_PRESET_CHANGED_BEFORE, ({ preset, savePreset }) => {
    setCachedSavePreset(savePreset);
    cancelManualSelection();
    loadFromPreset(preset.extensions?.prompt_folding);
    log('OAI_PRESET_CHANGED_BEFORE: loaded new preset data');
});

eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => {
    const listContainer = document.querySelector(config.selectors.promptList);
    if (listContainer) {
        buildCollapsibleGroups(listContainer);
        updateSettingsUI();
        if (localStorage.getItem('pf-fold-settings') === '1') applyFoldSettings(true);
    }
});

eventSource.on(event_types.OAI_PRESET_EXPORT_READY, (preset) => {
    preset.extensions ??= {};
    preset.extensions.prompt_folding = getStateForSave();
    log('Folding config injected into export');
});

eventSource.on(event_types.OAI_PRESET_IMPORT_READY, ({ data, presetName }) => {
    const pfData = data?.extensions?.prompt_folding;
    if (!pfData) return;
    loadFromPreset(pfData);
    log('OAI_PRESET_IMPORT_READY: loaded folding data for', presetName);
});
