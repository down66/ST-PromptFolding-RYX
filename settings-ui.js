import { state, saveCustomSettings, config, log, loadFromPreset, exportConfigFromPreset, importConfigToCurrentPreset, getCurrentPresetName, getAllPresetNames } from './state.js';
import { buildCollapsibleGroups } from './prompt-folding.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';

let listContainerRef = null;
let selectionSnapshot = null;
let foldRestoreInfo = null;

export async function createSettingsPanel(pmContainer, listContainer) {
    if (document.getElementById('pf-settings-panel')) return;

    listContainerRef = listContainer;

    try {
        const res = await fetch('/scripts/extensions/third-party/ST-PromptFolding-RYX/settings.html');
        const html = await res.text();

        const header = pmContainer.querySelector('.completion_prompt_manager_header');
        (header || pmContainer).insertAdjacentHTML(header ? 'afterend' : 'beforebegin', html);

        initLogic();
    } catch (err) {
        console.error('[PF] Load settings UI failed:', err);
    }
}

function initLogic() {
    const els = {
        textarea: document.getElementById('pf-dividers-input'),
        resetIcon: document.getElementById('pf-reset-icon'),
        radios: document.getElementsByName('folding-mode'),
        panel: document.getElementById('pf-settings-panel'),
        toggleBtn: document.querySelector('.pf-settings-toggle'),
        debugCheckbox: document.getElementById('pf-debug-mode'),
        dividerSettings: document.getElementById('pf-divider-settings'),
        manualControls: document.getElementById('pf-manual-controls'),
        startSelectBtn: document.getElementById('pf-start-select'),
        copyFromPresetSelect: document.getElementById('pf-copy-from-preset'),
        copyConfigBtn: document.getElementById('pf-copy-config-btn'),
        foldSettingsCheckbox: document.getElementById('pf-fold-settings'),
    };

    els.textarea.value = state.customDividers.join('\n');
    els.debugCheckbox.checked = state.debugMode;

    const foldSettingsEnabled = localStorage.getItem('pf-fold-settings') === '1';
    els.foldSettingsCheckbox.checked = foldSettingsEnabled;
    if (foldSettingsEnabled) applyFoldSettings(true);

    const currentRadio = document.querySelector(`input[name="folding-mode"][value="${state.foldingMode}"]`);
    if (currentRadio) currentRadio.checked = true;

    if (state.foldingMode === 'standard' || state.foldingMode === 'sandwich') {
        document.getElementById('pf-legacy-modes')?.setAttribute('open', '');
    }

    updateModeUI();

    // Fold settings checkbox
    els.foldSettingsCheckbox.onchange = () => {
        const checked = els.foldSettingsCheckbox.checked;
        localStorage.setItem('pf-fold-settings', checked ? '1' : '0');
        applyFoldSettings(checked);
    };

    // Debug toggle
    els.debugCheckbox.onchange = () => {
        state.debugMode = els.debugCheckbox.checked;
        saveCustomSettings();
        log('Debug mode:', state.debugMode);
        toastr.info(`Debug: ${state.debugMode ? 'ON' : 'OFF'}`);
    };

    // Mode switch
    document.getElementById('pf-mode-radios')?.addEventListener('change', (e) => {
        if (e.target.name === 'folding-mode') {
            state.foldingMode = e.target.value;
            saveCustomSettings();
            updateModeUI();
            refreshList();
            log('Mode changed:', state.foldingMode);
            toastr.success(`Mode: ${getModeDisplayName()}`);
        }
    });

    // Divider textarea auto-save on blur
    els.textarea.onblur = () => {
        const lines = els.textarea.value.split('\n').map(x => x.trim()).filter(x => x);
        if ((state.foldingMode === 'standard' || state.foldingMode === 'sandwich') && lines.length === 0) {
            toastr.warning('Please enter at least one divider symbol');
            return;
        }
        state.customDividers = lines;
        saveCustomSettings();
        refreshList();
    };

    // Reset
    els.resetIcon.onclick = () => handleReset(els);

    // Start selection
    els.startSelectBtn.onclick = () => startManualSelection();

    // Load preset list
    loadAvailablePresets(els.copyFromPresetSelect);
    els.copyFromPresetSelect.addEventListener('focus', () => loadAvailablePresets(els.copyFromPresetSelect));

    // Copy config
    els.copyConfigBtn.onclick = () => handleCopyConfig(els);

    loadMetaInfo();
}

function updateModeUI() {
    const isManual = state.foldingMode === 'manual';
    document.getElementById('pf-divider-settings').style.display = isManual ? 'none' : 'block';
    document.getElementById('pf-manual-controls').style.display = isManual ? 'block' : 'none';
}

function getModeDisplayName() {
    const names = { manual: 'Manual', standard: 'Standard', sandwich: 'Sandwich' };
    return names[state.foldingMode] || state.foldingMode;
}

async function handleReset(els) {
    const confirmed = await callGenericPopup(
        `<div>Reset all settings? This cannot be undone.</div>`,
        POPUP_TYPE.CONFIRM,
        '',
        { okButton: 'Reset', cancelButton: 'Cancel' },
    );
    if (!confirmed) return;

    loadFromPreset(null);
    saveCustomSettings();

    els.textarea.value = state.customDividers.join('\n');
    els.debugCheckbox.checked = false;
    document.querySelector('input[value="manual"]').checked = true;
    updateModeUI();
    refreshList();
    toastr.info('Reset to defaults');
}

function refreshList() {
    if (listContainerRef) {
        buildCollapsibleGroups(listContainerRef);
    }
}

// --- Manual Selection ---
function startManualSelection() {
    if (!listContainerRef) {
        toastr.error('Prompt list not found');
        return;
    }

    state.isSelectingHeaders = true;
    selectionSnapshot = new Set(state.manualHeaders);

    const allItems = listContainerRef.querySelectorAll(config.selectors.promptListItem);

    allItems.forEach(item => {
        if (item.querySelector('.pf-header-checkbox')) return;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'pf-header-checkbox';
        checkbox.checked = state.manualHeaders.has(item.dataset.pmIdentifier);

        checkbox.onclick = (e) => e.stopPropagation();
        checkbox.onchange = (e) => {
            e.stopPropagation();
            const id = item.dataset.pmIdentifier;
            if (checkbox.checked) {
                state.manualHeaders.add(id);
            } else {
                state.manualHeaders.delete(id);
            }
            updateFloatingCount();
        };

        item.insertBefore(checkbox, item.firstChild);
    });

    const startBtn = document.getElementById('pf-start-select');
    startBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Selecting...';
    startBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    startBtn.style.opacity = '0.5';
    startBtn.style.pointerEvents = 'none';
    startBtn.id = 'pf-finish-select';

    const panel = document.createElement('div');
    panel.id = 'pf-float-panel';
    panel.innerHTML = `
        <span id="pf-float-count"></span>
        <div id="pf-float-finish" class="menu_button menu_button_icon">
            <i class="fa-solid fa-check"></i>
        </div>
        <div id="pf-float-cancel" class="menu_button menu_button_icon">
            <i class="fa-solid fa-xmark"></i>
        </div>
    `;
    const wrapper = document.createElement('div');
    wrapper.id = 'pf-float-wrapper';
    wrapper.appendChild(panel);

    const navPanel = document.getElementById('left-nav-panel') || document.body;
    navPanel.appendChild(wrapper);

    panel.querySelector('#pf-float-finish').onclick = finishManualSelection;
    panel.querySelector('#pf-float-cancel').onclick = cancelManualSelection;

    updateFloatingCount();
    toastr.info('Check the entries you want as folders, then click confirm');
}

function updateFloatingCount() {
    const el = document.getElementById('pf-float-count');
    if (el) el.textContent = `Selected: ${state.manualHeaders.size}`;
}

function restoreSelectButton() {
    const btn = document.getElementById('pf-finish-select');
    if (!btn) return;
    btn.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> Start Selecting Folders';
    btn.style.background = 'rgba(74, 158, 255, 0.2)';
    btn.style.opacity = '';
    btn.style.pointerEvents = '';
    btn.onclick = startManualSelection;
    btn.id = 'pf-start-select';
}

function finishManualSelection() {
    state.isSelectingHeaders = false;
    selectionSnapshot = null;

    document.querySelectorAll('.pf-header-checkbox').forEach(cb => cb.remove());
    document.getElementById('pf-float-wrapper')?.remove();

    restoreSelectButton();
    saveCustomSettings();
    refreshList();

    toastr.success(`Selected ${state.manualHeaders.size} folder(s)`);
}

export function cancelManualSelection() {
    if (!state.isSelectingHeaders) return;

    state.isSelectingHeaders = false;

    if (selectionSnapshot !== null) {
        state.manualHeaders.clear();
        selectionSnapshot.forEach(id => state.manualHeaders.add(id));
        selectionSnapshot = null;
    }

    document.querySelectorAll('.pf-header-checkbox').forEach(cb => cb.remove());
    document.getElementById('pf-float-wrapper')?.remove();

    restoreSelectButton();
    toastr.info('Cancelled, restored previous selection');
}

// --- Fold Settings: collapse API params ---
export function applyFoldSettings(fold) {
    const DETAILS_ID = 'pf-api-fold-details';

    if (fold) {
        if (document.getElementById(DETAILS_ID)) return;

        const rangeBlock = document.getElementById('range_block_openai');
        if (!rangeBlock) return;

        const details = document.createElement('details');
        details.id = DETAILS_ID;

        const summary = document.createElement('summary');
        summary.textContent = 'API Settings (collapsed)';
        summary.className = 'pf-fold-settings-summary';
        details.appendChild(summary);

        const targets = [{ el: rangeBlock, parent: rangeBlock.parentElement, next: rangeBlock.nextSibling }];

        const openaiSettings = document.getElementById('openai_settings');
        if (openaiSettings) {
            const firstDiv = openaiSettings.querySelector(':scope > div');
            const firstRangeBlockMt1 = openaiSettings.querySelector(':scope > div.range-block.m-t-1');
            if (firstDiv) targets.push({ el: firstDiv, parent: openaiSettings, next: firstDiv.nextSibling });
            if (firstRangeBlockMt1) targets.push({ el: firstRangeBlockMt1, parent: openaiSettings, next: firstRangeBlockMt1.nextSibling });
        }

        foldRestoreInfo = targets.map(t => ({ el: t.el, parent: t.parent, next: t.next }));

        rangeBlock.parentElement.insertBefore(details, rangeBlock);
        targets.forEach(t => details.appendChild(t.el));
    } else {
        const details = document.getElementById(DETAILS_ID);
        if (!details || !foldRestoreInfo) return;

        foldRestoreInfo.slice().reverse().forEach(({ el, parent, next }) => {
            try {
                parent.insertBefore(el, next);
            } catch {
                parent.appendChild(el);
            }
        });

        foldRestoreInfo = null;
        details.remove();
    }
}

// --- Update settings UI from current state ---
export function updateSettingsUI() {
    const textarea = document.getElementById('pf-dividers-input');
    if (!textarea) return;

    textarea.value = state.customDividers.join('\n');

    const debugCheckbox = document.getElementById('pf-debug-mode');
    if (debugCheckbox) debugCheckbox.checked = state.debugMode;

    const foldSettingsCheckbox = document.getElementById('pf-fold-settings');
    if (foldSettingsCheckbox) {
        foldSettingsCheckbox.checked = localStorage.getItem('pf-fold-settings') === '1';
    }

    const currentRadio = document.querySelector(`input[name="folding-mode"][value="${state.foldingMode}"]`);
    if (currentRadio) currentRadio.checked = true;

    updateModeUI();
    loadAvailablePresets(document.getElementById('pf-copy-from-preset'));
}

function loadAvailablePresets(selectElement) {
    if (!selectElement) return;

    const currentPreset = getCurrentPresetName();
    const presets = getAllPresetNames().filter(p => p !== currentPreset);

    if (presets.length === 0) {
        selectElement.innerHTML = '<option value="">(No other Presets)</option>';
        return;
    }

    selectElement.innerHTML = '<option value="">Select Preset to Copy From</option>';
    presets.forEach(preset => {
        const option = document.createElement('option');
        option.value = preset;
        option.textContent = preset;
        selectElement.appendChild(option);
    });
}

async function handleCopyConfig(els) {
    const sourcePreset = els.copyFromPresetSelect.value;

    if (!sourcePreset) {
        toastr.warning('Please select a Preset first');
        return;
    }

    const confirmed = await callGenericPopup(
        `<div>Copy config from "${sourcePreset}" to current Preset?<br><br>` +
        `Will copy:<br>` +
        `- Folding mode<br>` +
        `- Divider symbols<br>` +
        `- Manually selected folders (UUID matched)<br></div>`,
        POPUP_TYPE.CONFIRM,
        '',
        { okButton: 'Copy', cancelButton: 'Cancel' },
    );

    if (!confirmed) return;

    try {
        const configData = await exportConfigFromPreset(sourcePreset);
        if (!configData) {
            toastr.warning(`"${sourcePreset}" has no folding config`);
            return;
        }

        if (!listContainerRef) {
            toastr.error('Prompt list not found');
            return;
        }

        const allItems = Array.from(listContainerRef.querySelectorAll(config.selectors.promptListItem));
        const matchResults = await importConfigToCurrentPreset(configData, allItems);

        updateSettingsUI();
        refreshList();

        let message = `Copied! Matched: ${matchResults.byUuid}`;
        if (matchResults.failed.length > 0) {
            message += ` | Failed: ${matchResults.failed.length}`;
        }
        toastr.success(message, 'Complete', { timeOut: 4000 });

    } catch (err) {
        console.error('[PF] Copy config failed:', err);
        toastr.error('Copy failed: ' + err.message);
    }
}

function loadMetaInfo() {
    fetch('/scripts/extensions/third-party/ST-PromptFolding-RYX/manifest.json')
        .then(r => r.json())
        .then(m => {
            const el = document.getElementById('pf-version-info');
            if (!el) return;
            el.innerHTML = `v${m.version} by <a href="${m.homePage}" target="_blank" rel="noopener" style="color: inherit; opacity: 0.7;">${m.author}</a>`;
        });
}
