import { config, state, dividerRegex, log, saveToPreset } from './state.js';

let _saveTimer = null;
function debouncedSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => saveToPreset().catch(console.error), 1500);
}

// --- Extract text name from <a> tag ---
function extractTextName(link) {
    const textNodes = Array.from(link.childNodes).filter(n => n.nodeType === 3);
    return textNodes.map(n => n.textContent).join('').trim();
}

// --- Check if LI is a header ---
function getGroupHeaderInfo(promptItem) {
  const link = promptItem.querySelector(config.selectors.promptLink);
  if (!link) return null;

  const itemId = promptItem.dataset.pmIdentifier;
  const currentName = extractTextName(link);

  const cachedName = state.originalNames.get(itemId);
  if (cachedName !== currentName) {
    log('Name changed for', itemId, ':', cachedName, '->', currentName);
    state.originalNames.set(itemId, currentName);
  }

  const originalName = currentName;
  const createInfo = (name) => ({ originalName: name, stableKey: itemId });

  // Manual mode: check if item is selected as header
  if (state.foldingMode === 'manual') {
    return state.manualHeaders.has(itemId) ? createInfo(originalName) : null;
  }

  // Standard/sandwich mode: match divider symbols
  return dividerRegex.test(originalName) ? createInfo(originalName) : null;
}

// --- Count child items in a group ---
function countGroupItems(items) {
  return items.filter(item => {
    // Don't count the header itself or any nested headers
    const info = getGroupHeaderInfo(item);
    return !info;
  }).length;
}

// --- Build Group DOM ---
function createGroupDOM(headerItem, headerInfo, contentItems) {
    const groupKey = headerInfo.stableKey;

    // Record state
    const childIds = contentItems.map(item => item.dataset.pmIdentifier).filter(Boolean);
    state.groupHierarchy[groupKey] = childIds;
    state.groupHeaderStatus[groupKey] = !headerItem.classList.contains('completion_prompt_manager_prompt_disabled');

    // Mark header item
    headerItem.classList.add(config.classNames.isGroupHeader);

    // Create <details> container
    const details = document.createElement('details');
    details.className = config.classNames.group;
    details.open = state.openGroups[groupKey] !== false;
    details.dataset.groupKey = groupKey;

    // Prevent native click on link
    const link = headerItem.querySelector(config.selectors.promptLink);
    if (link) {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, true);
    }

    // Click on name span toggles fold
    const nameSpan = headerItem.querySelector(config.selectors.promptNameSpan);
    if (nameSpan) {
        nameSpan.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            details.open = !details.open;
        }, true);
    }

    // Build summary (clickable header row)
    const summary = document.createElement('summary');
    summary.onclick = (e) => {
        if (e.target === summary) {
            e.preventDefault();
            details.open = !details.open;
        }
    };
    summary.appendChild(headerItem);
    details.appendChild(summary);

    // Build content area
    const contentDiv = document.createElement('div');
    contentDiv.className = config.classNames.groupContent;
    contentItems.forEach(item => contentDiv.appendChild(item));
    details.appendChild(contentDiv);

    // Listen for open/close
    details.ontoggle = () => {
        state.openGroups[groupKey] = details.open;
        debouncedSave();
    };

    return details;
}

// --- Main function: rebuild list with groups ---
export function buildCollapsibleGroups(listContainer) {
  log('Building collapsible groups, mode:', state.foldingMode);

  if (!listContainer || state.isProcessing) return;
  state.isProcessing = true;

  try {
    // Add grouping root class for CSS variable scoping
    listContainer.classList.add(config.classNames.groupingRoot);

    // 1. Get all items, reset to clean state
    const allItems = Array.from(listContainer.querySelectorAll(config.selectors.promptListItem));

    allItems.forEach(item => {
      item.classList.remove(config.classNames.isGroupHeader);
      const itemId = item.dataset.pmIdentifier;
      const link = item.querySelector(config.selectors.promptLink);
      if (link && itemId) {
        const currentName = extractTextName(link);
        state.originalNames.set(itemId, currentName);
      }
    });

    // 2. Clear and reset state
    listContainer.innerHTML = '';
    state.groupHierarchy = {};
    state.groupHeaderStatus = {};

    // 3. If disabled, just put items back
    if (!state.isEnabled) {
      allItems.forEach(item => listContainer.appendChild(item));
      listContainer.classList.remove(config.classNames.groupingRoot);
      return;
    }

    // --- Standard mode: split at each header ---
    const buildStandardGroups = () => {
      let buffer = [];
      let currentHeader = null;
      let currentHeaderInfo = null;

      const flushBuffer = () => {
        if (currentHeader) {
            listContainer.appendChild(createGroupDOM(currentHeader, currentHeaderInfo, buffer));
        } else {
            buffer.forEach(i => listContainer.appendChild(i));
        }
        buffer = [];
      };

      allItems.forEach(item => {
        const info = getGroupHeaderInfo(item);
        if (info) {
          flushBuffer();
          currentHeader = item;
          currentHeaderInfo = info;
        } else {
          buffer.push(item);
        }
      });
      flushBuffer();
    };

    // --- Sandwich mode: A...A pairing ---
    const buildSandwichGroups = () => {
      let remaining = [...allItems];

      while (remaining.length > 0) {
        const current = remaining.shift();
        const info = getGroupHeaderInfo(current);

        if (!info) {
          listContainer.appendChild(current);
          continue;
        }

        const closerIdx = remaining.findIndex(item => {
            const otherInfo = getGroupHeaderInfo(item);
            return otherInfo && otherInfo.originalName === info.originalName;
        });

        if (closerIdx !== -1) {
          const groupContent = remaining.splice(0, closerIdx + 1);
          listContainer.appendChild(createGroupDOM(current, info, groupContent));
        } else {
          listContainer.appendChild(current);
        }
      }
    };

    state.foldingMode === 'sandwich' ? buildSandwichGroups() : buildStandardGroups();

    // Apply disabled styles
    applyGroupDisabledStyles(listContainer);

    log('Groups built, total groups:', Object.keys(state.groupHierarchy).length);

  } catch (err) {
    console.error('[PF] Build failed:', err);
  } finally {
    state.isProcessing = false;
  }
}

// --- Expand/Collapse all ---
export function toggleAllGroups(listContainer, shouldOpen) {
  const details = listContainer.querySelectorAll(`.${config.classNames.group}`);
  details.forEach(el => {
      el.open = shouldOpen;
      state.openGroups[el.dataset.groupKey] = shouldOpen;
  });
  saveToPreset().catch(console.error);
}

// --- Apply disabled group visual styles ---
function applyGroupDisabledStyles(listContainer) {
    listContainer.querySelectorAll(`.${config.classNames.group}`).forEach(group => {
        const key = group.dataset.groupKey;
        if (!key) return;

        const isDisabled = state.groupHeaderStatus[key] === false;
        const contentItems = group.querySelectorAll(`.${config.classNames.groupContent} > li`);

        contentItems.forEach(item => {
            item.classList.toggle(config.classNames.disabledByGroup, isDisabled);
        });
    });
}
