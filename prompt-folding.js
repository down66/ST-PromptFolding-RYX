/**
 * Core rendering: scans prompt list, identifies headers, creates groups.
 * Uses 日月西's synthetic-header approach (not <details> wrapping).
 */

const SELECTORS = {
    list: '#completion_prompt_manager_list',
    item: 'li.completion_prompt_manager_prompt',
    listHead: 'li.completion_prompt_manager_list_head',
    name: 'a.prompt-manager-inspect-action',
};

const CLASSES = {
    root: 'ryx-grouping-root',
    header: 'ryx-group-header',
    caret: 'ryx-group-caret',
    title: 'ryx-group-title',
    count: 'ryx-group-count',
    collapsed: 'is-collapsed',
    itemCollapsed: 'ryx-group-item-collapsed',
    toolsRow: 'ryx-head-tools-row',
    toolsHost: 'ryx-name-tools-host',
    toolsList: 'ryx-list-tools',
    toolBtn: 'ryx-tool-btn',
    toolLabel: 'ryx-tool-label',
};

// --- State ---
let state = {
    enabled: true,
    // Manual mode: Set of prompt IDs that are headers
    manualHeaders: new Set(),
    // Divider-based mode: patterns that mark headers
    dividerPatterns: ['=', '-', '#'],
    // Collapsed groups: Set of group keys
    collapsedGroups: new Set(),
    // Current mode: 'manual' or 'divider'
    mode: 'divider',
};

// Build regex from divider patterns
function buildDividerRegex() {
    const patterns = state.dividerPatterns
        .map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`^(${patterns.join('|')})`);
}

// Check if an item is a header
function isHeader(item, promptId, promptName) {
    if (state.mode === 'manual') {
        return state.manualHeaders.has(promptId);
    }
    // Divider mode: name starts with a divider pattern
    return buildDividerRegex().test(promptName);
}

// Extract prompt name from item
function getPromptName(item) {
    const link = item.querySelector(SELECTORS.name);
    if (!link) return '';
    const textNodes = Array.from(link.childNodes).filter(n => n.nodeType === 3);
    return textNodes.map(n => n.textContent).join('').trim();
}

// Get prompt ID from item
function getPromptId(item) {
    return item.dataset.pmIdentifier || '';
}

// --- Create a synthetic group header element ---
function createHeader(groupName, itemCount, groupKey) {
    const li = document.createElement('li');
    li.className = CLASSES.header;
    li.dataset.ryxGroupKey = groupKey;
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-expanded', 'true');

    if (state.collapsedGroups.has(groupKey)) {
        li.classList.add(CLASSES.collapsed);
        li.setAttribute('aria-expanded', 'false');
    }

    // Caret (▼ / ▶)
    const caret = document.createElement('span');
    caret.className = CLASSES.caret;
    caret.innerHTML = '&#9654;'; // ▶ (rotates to ▼ when expanded)
    li.appendChild(caret);

    // Title
    const title = document.createElement('span');
    title.className = CLASSES.title;
    title.textContent = groupName;
    li.appendChild(title);

    // Item count badge
    const count = document.createElement('span');
    count.className = CLASSES.count;
    count.textContent = String(itemCount);
    li.appendChild(count);

    // Click to toggle
    const toggle = () => {
        const isCollapsed = li.classList.toggle(CLASSES.collapsed);
        li.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        if (isCollapsed) {
            state.collapsedGroups.add(groupKey);
        } else {
            state.collapsedGroups.delete(groupKey);
        }
        // Update children visibility
        updateChildren(li, groupKey, isCollapsed);
        saveState();
    };

    li.addEventListener('click', toggle);
    li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
        }
    });

    return li;
}

// Update children visibility based on collapse state
function updateChildren(header, groupKey, isCollapsed) {
    const list = document.querySelector(SELECTORS.list);
    if (!list) return;

    // Find all items with this group key and toggle their visibility
    const items = list.querySelectorAll(`li.completion_prompt_manager_prompt[data-ryx-group="${groupKey}"]`);
    items.forEach(item => {
        item.classList.toggle(CLASSES.itemCollapsed, isCollapsed);
    });
}

// --- Main rebuild function ---
export function rebuild() {
    const list = document.querySelector(SELECTORS.list);
    if (!list) return;

    // Add root class for CSS variables
    list.classList.add(CLASSES.root);

    // Remove existing headers and toolbar
    list.querySelectorAll(`.${CLASSES.header}`).forEach(h => h.remove());
    list.querySelectorAll(`.${CLASSES.toolsRow}`).forEach(r => r.remove());

    // Get all prompt items (excluding list-head)
    const allItems = Array.from(list.querySelectorAll(SELECTORS.item));
    if (allItems.length === 0) return;

    // Clear previous group assignments
    allItems.forEach(item => {
        item.classList.remove(CLASSES.itemCollapsed);
        delete item.dataset.ryxGroup;
    });

    if (!state.enabled) return;

    // First pass: identify headers and build groups
    const groups = [];
    let currentGroup = null;

    allItems.forEach(item => {
        const id = getPromptId(item);
        const name = getPromptName(item);

        if (isHeader(item, id, name)) {
            // Start a new group
            currentGroup = { name, key: id, items: [] };
            groups.push(currentGroup);
        } else if (currentGroup) {
            // Add to current group
            currentGroup.items.push(item);
        }
        // If no current group and item is not a header, it stays ungrouped
    });

    if (groups.length === 0) return;

    // Second pass: insert headers and mark children
    const insertBeforeMap = new Map(); // groupKey -> reference element

    groups.forEach(group => {
        if (group.items.length === 0) return;

        const firstChild = group.items[0];
        const groupKey = group.key;

        // Mark all items in this group
        group.items.forEach(item => {
            item.dataset.ryxGroup = groupKey;
        });

        // Create header and insert before first child
        const header = createHeader(group.name, group.items.length, groupKey);
        insertBeforeMap.set(groupKey, { header, before: firstChild });
    });

    // Insert headers (reverse order to maintain positions)
    const entries = [...insertBeforeMap.values()].reverse();
    entries.forEach(({ header, before }) => {
        list.insertBefore(header, before);
    });

    // Apply collapse state
    groups.forEach(group => {
        if (state.collapsedGroups.has(group.key)) {
            group.items.forEach(item => {
                item.classList.add(CLASSES.itemCollapsed);
            });
        }
    });

    // Insert or update toolbar
    insertToolbar(list);
}

// --- Toolbar ---
function insertToolbar(list) {
    const listHead = list.querySelector(SELECTORS.listHead);
    if (!listHead) return;

    // Remove existing
    list.querySelectorAll(`.${CLASSES.toolsRow}`).forEach(r => r.remove());

    const row = document.createElement('li');
    row.className = CLASSES.toolsRow;

    const host = document.createElement('span');
    host.className = CLASSES.toolsHost;

    const tools = document.createElement('span');
    tools.className = CLASSES.toolsList;

    // Expand All button
    tools.appendChild(makeToolBtn('展开全部', 'ryx_expand_all', () => expandAll()));

    // Collapse All button
    tools.appendChild(makeToolBtn('收起全部', 'ryx_collapse_all', () => collapseAll()));

    // Toggle on/off button
    tools.appendChild(makeToolBtn(state.enabled ? '分组: 开' : '分组: 关', 'ryx_toggle_grouping', () => {
        state.enabled = !state.enabled;
        saveState();
        rebuild();
    }));

    host.appendChild(tools);
    row.appendChild(host);
    list.insertBefore(row, listHead.nextSibling);
}

function makeToolBtn(label, action, onClick) {
    const btn = document.createElement('button');
    btn.className = CLASSES.toolBtn;
    btn.dataset.action = action;
    btn.type = 'button';

    const span = document.createElement('span');
    span.className = CLASSES.toolLabel;
    span.textContent = label;
    btn.appendChild(span);

    btn.addEventListener('click', onClick);
    return btn;
}

function expandAll() {
    state.collapsedGroups.clear();
    document.querySelectorAll(`.${CLASSES.header}`).forEach(h => {
        h.classList.remove(CLASSES.collapsed);
        h.setAttribute('aria-expanded', 'true');
    });
    document.querySelectorAll(`.${CLASSES.itemCollapsed}`).forEach(item => {
        item.classList.remove(CLASSES.itemCollapsed);
    });
    saveState();
}

function collapseAll() {
    document.querySelectorAll(`.${CLASSES.header}`).forEach(h => {
        const key = h.dataset.ryxGroupKey;
        if (key) state.collapsedGroups.add(key);
        h.classList.add(CLASSES.collapsed);
        h.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll(`li.completion_prompt_manager_prompt[data-ryx-group]`).forEach(item => {
        item.classList.add(CLASSES.itemCollapsed);
    });
    saveState();
}

// --- Persistence (localStorage) ---
const STORAGE_KEY = 'ryx_prompt_folding';

function saveState() {
    try {
        const data = {
            enabled: state.enabled,
            mode: state.mode,
            manualHeaders: [...state.manualHeaders],
            dividerPatterns: state.dividerPatterns,
            collapsedGroups: [...state.collapsedGroups],
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('[RYX] Failed to save state:', e);
    }
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        state.enabled = data.enabled ?? true;
        state.mode = data.mode ?? 'divider';
        state.manualHeaders = new Set(data.manualHeaders || []);
        state.dividerPatterns = data.dividerPatterns || ['=', '-', '#'];
        state.collapsedGroups = new Set(data.collapsedGroups || []);
    } catch (e) {
        console.warn('[RYX] Failed to load state:', e);
    }
}

// --- Public API ---
export function init() {
    loadState();
    rebuild();
}

export function getState() { return state; }

export function setMode(mode) {
    state.mode = mode;
    saveState();
    rebuild();
}

export function setDividerPatterns(patterns) {
    state.dividerPatterns = patterns;
    saveState();
    rebuild();
}

export function setManualHeaders(ids) {
    state.manualHeaders = new Set(ids);
    saveState();
    rebuild();
}

export function toggleEnabled() {
    state.enabled = !state.enabled;
    saveState();
    rebuild();
}
