export function buildCanvasPanZoomRuntimeScript({
    hostSelector = '#panzoom-host',
    targetSelector = 'svg',
    minScale = 0.2,
    maxScale = 6
} = {}) {
    const hostLiteral = JSON.stringify(String(hostSelector || '#panzoom-host'));
    const targetLiteral = JSON.stringify(String(targetSelector || 'svg'));
    const minValue = Number.isFinite(minScale) ? minScale : 0.2;
    const maxValue = Number.isFinite(maxScale) ? maxScale : 6;

    return `
(function () {
  const host = document.querySelector(${hostLiteral});
  if (!host) return;
  const target = host.querySelector(${targetLiteral});
  if (!target) return;

  host.style.touchAction = 'none';
  host.style.userSelect = 'none';
  host.style.webkitUserSelect = 'none';
  host.style.webkitTapHighlightColor = 'transparent';
  host.addEventListener('selectstart', (event) => event.preventDefault());

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  const min = ${minValue};
  const max = ${maxValue};
  const pointers = new Map();
  const capturedPointerIds = new Set();

  let dragStartX = 0;
  let dragStartY = 0;
  let dragBaseX = 0;
  let dragBaseY = 0;
  let pinchStartScale = 1;
  let pinchStartTranslateX = 0;
  let pinchStartTranslateY = 0;
  let pinchStartDistance = 0;
  let pinchAnchorContentX = 0;
  let pinchAnchorContentY = 0;
  let hasMovedPointer = false;

  const clampScale = (value) => Math.min(max, Math.max(min, value));
  const applyTransform = () => {
    target.style.transform = 'translate(' + translateX + 'px,' + translateY + 'px) scale(' + scale + ')';
  };
  const getLocalPoint = (clientX, clientY) => {
    const rect = host.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };
  const beginDragFromPointer = (pointer) => {
    dragStartX = pointer.clientX;
    dragStartY = pointer.clientY;
    dragBaseX = translateX;
    dragBaseY = translateY;
    hasMovedPointer = false;
    host.classList.add('is-dragging');
  };
  const beginPinch = () => {
    const active = Array.from(pointers.values());
    if (active.length < 2) return;
    const p1 = active[0];
    const p2 = active[1];
    const centerClientX = (p1.clientX + p2.clientX) * 0.5;
    const centerClientY = (p1.clientY + p2.clientY) * 0.5;
    const center = getLocalPoint(centerClientX, centerClientY);
    const dx = p2.clientX - p1.clientX;
    const dy = p2.clientY - p1.clientY;
    pinchStartDistance = Math.hypot(dx, dy) || 1;
    pinchStartScale = scale;
    pinchStartTranslateX = translateX;
    pinchStartTranslateY = translateY;
    pinchAnchorContentX = (center.x - pinchStartTranslateX) / pinchStartScale;
    pinchAnchorContentY = (center.y - pinchStartTranslateY) / pinchStartScale;
    host.classList.remove('is-dragging');
  };
  const resetTransform = () => {
    scale = 1;
    translateX = 0;
    translateY = 0;
    applyTransform();
  };
  const zoomAroundPoint = (factor, localX, localY) => {
    const nextScale = clampScale(scale * factor);
    const ratio = nextScale / scale;
    translateX = localX - (localX - translateX) * ratio;
    translateY = localY - (localY - translateY) * ratio;
    scale = nextScale;
    applyTransform();
  };
  const capturePointer = (event) => {
    if (capturedPointerIds.has(event.pointerId)) return;
    try {
      host.setPointerCapture(event.pointerId);
      capturedPointerIds.add(event.pointerId);
    } catch (_) { }
  };

  host.addEventListener('wheel', (event) => {
    event.preventDefault();
    const local = getLocalPoint(event.clientX, event.clientY);
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    zoomAroundPoint(factor, local.x, local.y);
  }, { passive: false });

  host.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (pointers.size === 1) {
      beginDragFromPointer({ clientX: event.clientX, clientY: event.clientY });
    } else if (pointers.size === 2) {
      capturePointer(event);
      beginPinch();
    }
  });

  host.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });

    if (pointers.size >= 2) {
      event.preventDefault();
      capturePointer(event);
      const active = Array.from(pointers.values());
      const p1 = active[0];
      const p2 = active[1];
      const centerClientX = (p1.clientX + p2.clientX) * 0.5;
      const centerClientY = (p1.clientY + p2.clientY) * 0.5;
      const center = getLocalPoint(centerClientX, centerClientY);
      const dx = p2.clientX - p1.clientX;
      const dy = p2.clientY - p1.clientY;
      const currentDistance = Math.hypot(dx, dy) || 1;
      const nextScale = clampScale(pinchStartScale * (currentDistance / pinchStartDistance));
      scale = nextScale;
      translateX = center.x - pinchAnchorContentX * nextScale;
      translateY = center.y - pinchAnchorContentY * nextScale;
      applyTransform();
      return;
    }

    if (pointers.size === 1) {
      const movedX = event.clientX - dragStartX;
      const movedY = event.clientY - dragStartY;
      hasMovedPointer = hasMovedPointer || Math.hypot(movedX, movedY) > 3;
      if (!hasMovedPointer) return;
      event.preventDefault();
      capturePointer(event);
      translateX = dragBaseX + movedX;
      translateY = dragBaseY + movedY;
      applyTransform();
    }
  });

  const releasePointer = (event) => {
    pointers.delete(event.pointerId);
    if (capturedPointerIds.has(event.pointerId)) {
      try { host.releasePointerCapture(event.pointerId); } catch (_) { }
      capturedPointerIds.delete(event.pointerId);
    }

    if (pointers.size >= 2) {
      beginPinch();
      return;
    }

    if (pointers.size === 1) {
      const remain = Array.from(pointers.values())[0];
      beginDragFromPointer(remain);
      return;
    }

    host.classList.remove('is-dragging');
  };

  host.addEventListener('pointerup', releasePointer);
  host.addEventListener('pointercancel', releasePointer);
  host.addEventListener('pointerleave', releasePointer);
  host.addEventListener('click', (event) => {
    if (!hasMovedPointer) return;
    event.preventDefault();
    event.stopPropagation();
    hasMovedPointer = false;
  }, true);
  host.addEventListener('dblclick', resetTransform);

  applyTransform();
})();
`;
}
