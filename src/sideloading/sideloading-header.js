import { SIDELOADING_ICONS } from './sideloading-icons.js';

function createSideloadingAction(action) {
    if (action.type === 'divider') {
        const divider = document.createElement('span');
        divider.className = 'sideloading-divider';
        divider.setAttribute('aria-hidden', 'true');
        return divider;
    }

    if (action.type === 'segment') {
        const segment = document.createElement('div');
        segment.className = 'sideloading-segment';
        action.actions.forEach(item => segment.appendChild(createSideloadingAction(item)));
        return segment;
    }

    const button = document.createElement('button');
    button.type = 'button';
    if (action.id) button.id = action.id;
    if (!action.unstyled) button.className = 'sideloading-action';
    if (action.active) button.classList.add('active');
    if (action.drawerAction) button.dataset.drawerAction = action.drawerAction;
    if (action.i18nKey) {
        button.dataset.i18nTitle = action.i18nKey;
        button.dataset.i18nAriaLabel = action.i18nKey;
    }
    if (action.title) {
        button.title = action.title;
        button.setAttribute('aria-label', action.title);
    }
    button.innerHTML = action.html || SIDELOADING_ICONS[action.icon] || '';
    return button;
}

export function createSideloadingHeader({
    titleId = '',
    typeId = '',
    actions = []
} = {}) {
    const header = document.createElement('div');
    header.className = 'sideloading-header';

    const title = document.createElement('div');
    title.className = 'sideloading-title';
    const titleText = document.createElement('span');
    titleText.className = 'sideloading-title-text';
    if (titleId) titleText.id = titleId;
    const type = document.createElement('span');
    type.className = 'sideloading-type';
    if (typeId) type.id = typeId;
    title.append(titleText, type);

    const actionBar = document.createElement('div');
    actionBar.className = 'sideloading-actions';
    actions.forEach(action => actionBar.appendChild(createSideloadingAction(action)));
    header.append(title, actionBar);

    return { header, titleText, type, actionBar };
}
