/**
 * Prompt Folding Plugin (日月西 style)
 * Entry point — observes DOM, triggers rebuild on changes.
 */
import { rebuild } from './prompt-folding.js';

const LIST_SELECTOR = '#completion_prompt_manager_list';
const ITEM_SELECTOR = 'li.completion_prompt_manager_prompt';

let observer = null;
let rebuildTimer = null;
let isProcessing = false;

function debouncedRebuild() {
    if (isProcessing) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
        isProcessing = true;
        try {
            rebuild();
        } catch (e) {
            console.error('[RYX] Rebuild error:', e);
        } finally {
            isProcessing = false;
        }
    }, 200);
}

function setupObserver(listContainer) {
    if (observer) observer.disconnect();

    observer = new MutationObserver((mutations) => {
        if (isProcessing) return;

        const shouldRebuild = mutations.some(m => {
            if (m.type === 'childList') {
                const added = Array.from(m.addedNodes).some(
                    n => n.nodeType === 1 && (
                        n.matches?.(ITEM_SELECTOR) ||
                        n.querySelector?.(ITEM_SELECTOR)
                    )
                );
                const removed = Array.from(m.removedNodes).some(
                    n => n.nodeType === 1 && (
                        n.matches?.(ITEM_SELECTOR) ||
                        n.querySelector?.(ITEM_SELECTOR)
                    )
                );
                if (added || removed) return true;
            }
            // CharacterData: prompt name changed
            if (m.type === 'characterData') {
                const parent = m.target.parentElement;
                if (parent?.matches?.('a.prompt-manager-inspect-action')) return true;
            }
            return false;
        });

        if (shouldRebuild) {
            debouncedRebuild();
        }
    });

    observer.observe(listContainer, {
        childList: true,
        subtree: true,
        characterData: true,
    });
}

// Handle drag — pause observer during drag, rebuild after
function setupDragHandlers(listContainer) {
    listContainer.addEventListener('dragstart', () => {
        observer?.disconnect();
    });

    listContainer.addEventListener('dragend', () => {
        // Rebuild after drag settles
        setTimeout(() => {
            debouncedRebuild();
            if (observer && listContainer) {
                observer.observe(listContainer, {
                    childList: true,
                    subtree: true,
                    characterData: true,
                });
            }
        }, 200);
    });
}

// --- Init ---
function tryInit(listContainer) {
    if (!listContainer) return;
    if (listContainer.dataset.ryxInitialized) return;
    listContainer.dataset.ryxInitialized = '1';

    console.log('[RYX] Prompt Folding initializing...');
    rebuild();
    setupObserver(listContainer);
    setupDragHandlers(listContainer);
    console.log('[RYX] Ready. Groups will be auto-detected by divider patterns.');
}

// Wait for the list to appear
const globalObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
        for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches?.(LIST_SELECTOR)) {
                tryInit(node);
                return;
            }
            const list = node.querySelector?.(LIST_SELECTOR);
            if (list) {
                tryInit(list);
                return;
            }
        }
    }
});
globalObserver.observe(document.body, { childList: true, subtree: true });

// Try immediate init
const existingList = document.querySelector(LIST_SELECTOR);
if (existingList) tryInit(existingList);

// Listen for DOM removal (e.g., preset switch replaces the entire list)
const removalObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
        for (const node of m.removedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches?.(LIST_SELECTOR) || node.querySelector?.(LIST_SELECTOR)) {
                // Old list removed, clear init flag so new list can be picked up
                delete node.dataset?.ryxInitialized;
                const inner = node.querySelector?.(LIST_SELECTOR);
                if (inner) delete inner.dataset.ryxInitialized;
                observer?.disconnect();
            }
        }
    }
});
removalObserver.observe(document.body, { childList: true, subtree: true });
